import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type ActionClass, NEVER_WITHOUT_ASKING } from "../security/actions.js";
import { type Registry, ok, err } from "../transport/rpc.js";

const ACTION_CLASSES: ReadonlySet<string> = new Set(["read", "write", "send", "spend", "delete", "change_setting"]);

export interface DecisionEntry {
  ts: number;
  actionClass: ActionClass;
  signature: string;
  allowed: boolean;
}

/**
 * Learned-autonomy store (Alfred's ask→confirm→act). Two persisted parts:
 *  - an append-only decision log ({actionClass, signature, allowed, ts}) of every gate verdict, and
 *  - an auto-approve grant list the ApprovalGate consults BEFORE asking.
 *
 * Fail-closed on every axis:
 *  - grants AND learned tiers can NEVER cover send/spend/delete/change_setting — always-ask (hard floor);
 *  - a grant only exists once the human issues one (vishu.autonomy_grant); the gate NEVER self-grants;
 *  - after N clean approvals of a reversible signature the gate both SUGGESTS a grant on the bus AND
 *    forms a learned auto-allow tier (isLearned) so a proven-safe reversible action stops nagging.
 *
 * ponytail: signature = tool name (mirrors the §11d graduation target) — the laziest stable unit.
 * Upgrade to a finer key (shell program, path) if one tool needs per-argument grants.
 */
export class DecisionStore {
  private readonly grants: Set<string>;
  constructor(
    private readonly logFile: string,
    private readonly grantFile: string,
    private readonly threshold = 3,
  ) {
    this.grants = this.loadGrants();
  }

  private key(actionClass: ActionClass, signature: string): string {
    return `${actionClass} ${signature}`;
  }

  /** Append one gate verdict (best-effort — a lost line only delays a suggestion). */
  record(entry: DecisionEntry): void {
    try {
      mkdirSync(dirname(this.logFile), { recursive: true });
      appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`);
    } catch {
      /* best-effort */
    }
  }

  /** Recent decisions, newest first. */
  list(limit = 50): DecisionEntry[] {
    let lines: string[];
    try {
      lines = readFileSync(this.logFile, "utf8").split("\n").filter(Boolean);
    } catch {
      return [];
    }
    const out: DecisionEntry[] = [];
    for (const l of lines) {
      try {
        out.push(JSON.parse(l) as DecisionEntry);
      } catch {
        /* skip a torn line */
      }
    }
    return out.reverse().slice(0, limit);
  }

  /** Are the most recent decisions for this signature an unbroken run of ≥threshold allows?
   * (list() is newest-first, so the first deny encountered breaks the streak.) */
  private streakMet(actionClass: ActionClass, signature: string): boolean {
    let streak = 0;
    for (const e of this.list()) {
      if (e.actionClass !== actionClass || e.signature !== signature) continue;
      if (!e.allowed) return false;
      if (++streak >= this.threshold) return true;
    }
    return false;
  }

  /** True once a reversible signature has N consecutive clean approvals (a deny breaks the run) and
   * is not already granted — the single moment the gate should suggest auto-approval. */
  shouldSuggest(actionClass: ActionClass, signature: string): boolean {
    if (NEVER_WITHOUT_ASKING.has(actionClass)) return false; // floor classes never graduate
    if (this.isGranted(actionClass, signature)) return false; // already auto-approved
    return this.streakMet(actionClass, signature);
  }

  /** Learned auto-allow tier: a reversible signature whose newest N decisions are ALL allowed is
   * promoted from the approval log itself — no manual grant needed. Floor classes can NEVER be
   * learned (checked here AND the gate's floor block returns before this is ever consulted). */
  isLearned(actionClass: ActionClass, signature: string): boolean {
    if (NEVER_WITHOUT_ASKING.has(actionClass)) return false;
    return this.streakMet(actionClass, signature);
  }

  /** Break a learned tier by recording a synthetic deny — the next same-signature ask must re-earn it. */
  unlearn(actionClass: ActionClass, signature: string): void {
    this.record({ ts: Date.now(), actionClass, signature, allowed: false });
  }

  /** Signatures currently auto-allowed purely from the approval log (the learned tier), for display. */
  learnedList(): { actionClass: string; signature: string }[] {
    const seen = new Set<string>();
    const out: { actionClass: string; signature: string }[] = [];
    for (const e of this.list()) {
      const k = this.key(e.actionClass, e.signature);
      if (seen.has(k)) continue;
      seen.add(k);
      if (this.isLearned(e.actionClass, e.signature)) out.push({ actionClass: e.actionClass, signature: e.signature });
    }
    return out;
  }

  isGranted(actionClass: ActionClass, signature: string): boolean {
    return this.grants.has(this.key(actionClass, signature));
  }

  /** Add an auto-approve grant. Refuses hard-floor classes (fail-closed). */
  grant(actionClass: ActionClass, signature: string): { granted: boolean; reason?: string } {
    if (NEVER_WITHOUT_ASKING.has(actionClass)) return { granted: false, reason: `${actionClass} is always-ask` };
    this.grants.add(this.key(actionClass, signature));
    this.saveGrants();
    return { granted: true };
  }

  revoke(actionClass: ActionClass, signature: string): { revoked: boolean } {
    const had = this.grants.delete(this.key(actionClass, signature));
    if (had) this.saveGrants();
    return { revoked: had };
  }

  grantList(): { actionClass: string; signature: string }[] {
    return [...this.grants].map((k) => {
      const sp = k.indexOf(" ");
      return { actionClass: k.slice(0, sp), signature: k.slice(sp + 1) };
    });
  }

  private loadGrants(): Set<string> {
    try {
      return new Set(JSON.parse(readFileSync(this.grantFile, "utf8")) as string[]);
    } catch {
      return new Set();
    }
  }

  private saveGrants(): void {
    try {
      mkdirSync(dirname(this.grantFile), { recursive: true });
      writeFileSync(this.grantFile, JSON.stringify([...this.grants]));
    } catch {
      /* best-effort — a lost grant just asks again */
    }
  }
}

/** Expose the decision log + grant controls over RPC (registered near the mode RPCs in bin). */
export function registerDecisions(registry: Registry, store: DecisionStore): void {
  registry.register("vishu.decisions_list", (params) => {
    const limit = Number((params as { limit?: number } | undefined)?.limit) || 50;
    return ok({ decisions: store.list(limit), grants: store.grantList(), learned: store.learnedList() });
  });
  registry.register("vishu.autonomy_grant", (params) => {
    const p = params as { actionClass?: string; signature?: string } | undefined;
    if (!p?.actionClass || !p.signature || !ACTION_CLASSES.has(p.actionClass)) return err("invalid", "actionClass and signature required");
    return ok(store.grant(p.actionClass as ActionClass, p.signature));
  });
  registry.register("vishu.autonomy_revoke", (params) => {
    const p = params as { actionClass?: string; signature?: string } | undefined;
    if (!p?.actionClass || !p.signature || !ACTION_CLASSES.has(p.actionClass)) return err("invalid", "actionClass and signature required");
    const r = store.revoke(p.actionClass as ActionClass, p.signature);
    store.unlearn(p.actionClass as ActionClass, p.signature); // also break a learned streak, so revoke undoes either kind
    return ok(r);
  });
}
