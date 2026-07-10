import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolCall } from "../providers/types.js";
import { isPaused as defaultIsPaused } from "../automation/pause.js";
import { type ActionClass, classifyTool, NEVER_WITHOUT_ASKING } from "../security/actions.js";
import type { AuditLog } from "../security/audit.js";
import { classifyCommand, type CommandClass } from "../security/classify.js";

export type Autonomy = "ask_every_time" | "ask_once" | "automatic";

export interface ApprovalRequest {
  tool: string;
  summary: string;
  klass: CommandClass;
  action: ActionClass;
  /** When set, the human must TYPE this exact phrase to confirm (stricter than y/N). Used for send/spend. */
  confirm?: string;
}

export interface ApprovalDecision {
  allowed: boolean;
  reason?: string;
}

export type AskFn = (req: ApprovalRequest) => Promise<boolean>;

export interface ApprovalOpts {
  /** Resolve a tool's action class (default: name heuristic; wire the ToolRegistry's getAction here). */
  actionOf?: (name: string) => ActionClass;
  /** Is the global pause engaged? (default: the flag-file check). Injected for tests. */
  isPaused?: () => boolean;
  /** Append-only decision log (UPGRADES §2). Absent → decisions aren't persisted. */
  audit?: AuditLog;
  /** Persist ask_once remembers here so a remembered "yes" survives restart (UPGRADES §1). Absent → in-memory only. */
  rememberFile?: string;
  /** Max send-class actions per day (UPGRADES §1 / PLAN F7 ≤30/day). Default 30. */
  sendCap?: number;
  /** Persist the daily send counter here so the cap survives restart. Absent → in-memory (per-process). */
  sendCapFile?: string;
}

// Pausing must work even while paused, so the pause controls themselves are never pause-denied.
const PAUSE_EXEMPT = new Set(["jarvis_pause", "jarvis_resume"]);

/** Risk-scoped approvals with a hard floor:
 *  - send/spend/delete/change_setting ALWAYS ask (even automatic, even ask_once — no remembering).
 *  - while globally paused, every non-read action is denied (pause controls exempt).
 *  - otherwise: auto-allow reads + safe writes; interrupt only for risky shell. */
export class ApprovalGate {
  private readonly remembered = new Map<string, boolean>();
  private readonly actionOf: (name: string) => ActionClass;
  private readonly isPaused: () => boolean;
  private readonly audit?: AuditLog;
  private readonly rememberFile?: string;
  private readonly sendCap: number;
  private readonly sendCapFile?: string;
  private sendMemDate = "";
  private sendMemCount = 0;
  constructor(
    private readonly autonomy: Autonomy,
    private readonly ask: AskFn,
    opts: ApprovalOpts = {},
  ) {
    this.actionOf = opts.actionOf ?? classifyTool;
    this.isPaused = opts.isPaused ?? defaultIsPaused;
    this.audit = opts.audit;
    this.rememberFile = opts.rememberFile;
    this.sendCap = opts.sendCap ?? 30;
    this.sendCapFile = opts.sendCapFile;
    this.loadRemembered();
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** How many send-class actions have already been approved today (resets at UTC midnight). */
  private sendsToday(): number {
    if (this.sendCapFile) {
      try {
        const c = JSON.parse(readFileSync(this.sendCapFile, "utf8")) as { date: string; count: number };
        return c.date === this.today() ? c.count : 0;
      } catch {
        return 0;
      }
    }
    return this.sendMemDate === this.today() ? this.sendMemCount : 0;
  }

  private recordSend(): void {
    const next = this.sendsToday() + 1;
    if (this.sendCapFile) {
      try {
        mkdirSync(dirname(this.sendCapFile), { recursive: true });
        writeFileSync(this.sendCapFile, JSON.stringify({ date: this.today(), count: next }));
      } catch {
        /* best-effort — worst case the cap under-counts after a write failure */
      }
    } else {
      this.sendMemDate = this.today();
      this.sendMemCount = next;
    }
  }

  /** Load persisted ask_once remembers (best-effort — a missing/corrupt file just starts empty). */
  private loadRemembered(): void {
    if (!this.rememberFile) return;
    try {
      const obj = JSON.parse(readFileSync(this.rememberFile, "utf8")) as Record<string, boolean>;
      for (const [k, v] of Object.entries(obj)) this.remembered.set(k, Boolean(v));
    } catch {
      /* no file yet or unreadable — remembers just start empty */
    }
  }

  private saveRemembered(): void {
    if (!this.rememberFile) return;
    try {
      mkdirSync(dirname(this.rememberFile), { recursive: true });
      writeFileSync(this.rememberFile, JSON.stringify(Object.fromEntries(this.remembered)));
    } catch {
      /* best-effort — losing a persisted remember is safe (worst case: it asks again) */
    }
  }

  async decide(call: ToolCall): Promise<ApprovalDecision> {
    const action = this.actionOf(call.name);
    const decision = await this.evaluate(call, action);
    this.audit?.record({ kind: "gate", tool: call.name, action, verdict: decision.allowed ? "allow" : "deny", reason: decision.reason });
    return decision;
  }

  private async evaluate(call: ToolCall, action: ActionClass): Promise<ApprovalDecision> {
    const klass = call.name === "run_shell" ? classifyCommand(String(call.arguments.command ?? "")) : "safe";

    // Global pause: deny everything with a side effect. Reads and the pause controls pass.
    if (this.isPaused() && !PAUSE_EXEMPT.has(call.name) && action !== "read") {
      return { allowed: false, reason: "paused (global pause active)" };
    }

    // Hard floor: irreversible/outbound classes are always confirmed, per-call, regardless of autonomy.
    if (NEVER_WITHOUT_ASKING.has(action)) {
      // Daily send cap (PLAN F7 ≤30/day) — deny before even prompting once the day's quota is spent.
      if (action === "send" && this.sendsToday() >= this.sendCap) {
        return { allowed: false, reason: `daily send cap reached (${this.sendCap}/day)` };
      }
      // send/spend demand a TYPED phrase, not a bare y/N — a stricter, deliberate confirmation.
      const confirm = action === "send" || action === "spend" ? action.toUpperCase() : undefined;
      const ok = await this.ask({ tool: call.name, summary: summarize(call), klass, action, confirm });
      if (ok && action === "send") this.recordSend();
      return { allowed: ok, reason: ok ? undefined : "user denied" };
    }

    // Everything else: only risky shell needs a human; reads + safe writes auto-allow.
    if (this.autonomy === "automatic" || klass === "safe") return { allowed: true };

    if (this.autonomy === "ask_once" && this.remembered.has(call.name)) {
      return { allowed: this.remembered.get(call.name)!, reason: "remembered" };
    }

    const ok = await this.ask({ tool: call.name, summary: summarize(call), klass, action });
    if (this.autonomy === "ask_once") {
      this.remembered.set(call.name, ok);
      this.saveRemembered(); // durable across restarts (UPGRADES §1)
    }
    return { allowed: ok, reason: ok ? undefined : "user denied" };
  }
}

function summarize(call: ToolCall): string {
  return JSON.stringify(call.arguments).slice(0, 200);
}
