import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Router } from "../providers/router.js";
import { ApprovalGate, type AskFn } from "../reliability/approvals.js";
import type { RunLog } from "../reliability/runlog.js";
import { makePolicy, type SecurityPolicy, type Tier } from "../security/policy.js";
import { runToolLoop } from "../tools/loop.js";
import type { ToolRegistry } from "../tools/registry.js";
import { sandboxedTerminal } from "../tools/terminal.js";
import { type Archetype, narrowRegistry, narrowTier } from "./archetypes.js";

export interface ValidationResult {
  ok: boolean;
  output: string;
}

export interface SubagentOptions {
  archetype: Archetype;
  task: string;
  /** Threaded parent context — required; spawning without it is the original NoParentContext contract. */
  parentContext: string;
  parentPolicy: SecurityPolicy;
  parentRegistry: ToolRegistry;
  router: Router;
  model: string;
  /** Git repo the worktree branches from (the isolation boundary). */
  repoDir: string;
  tier?: Tier;
  /** Dev/test validation run against the worktree after the subagent finishes. */
  validate?: (worktreeDir: string) => Promise<ValidationResult>;
  /** On success, commit the worktree and merge its branch back into `repoDir` (harvest the winner). */
  harvest?: boolean;
  /** Keep the worktree + branch alive after returning (caller must invoke `outcome.cleanup`). Lets the
   * parallel Coordinator pick a winner first, then merge that one branch serially — no concurrent merges. */
  keepWorktree?: boolean;
  maxIterations?: number;
  runLog?: RunLog;
  /** Approve the subagent's gated actions. Absent → deny (fail-closed: a background subagent never
   * sends/spends/deletes/changes settings unattended). Reads + writes in its worktree flow freely. */
  ask?: AskFn;
}

export interface SubagentOutcome {
  ok: boolean;
  archetype: string;
  final: string;
  validation: ValidationResult;
  worktree: string;
  /** The branch holding this subagent's work — usable for a deferred merge when `keepWorktree`. */
  branch: string;
  /** True if the winning branch's changes were merged back into the action repo (harvest). */
  merged: boolean;
  /** Remove the worktree + branch. A no-op unless `keepWorktree` was set (then the caller must call it). */
  cleanup: () => void;
}

export class NoParentContextError extends Error {
  constructor() {
    super("[orchestration] subagent spawned without parent context");
    this.name = "NoParentContextError";
  }
}

function git(cwd: string, ...args: string[]): { code: number; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Idempotently make `dir` a git repo with at least one commit (worktrees need a HEAD). */
export function ensureRepo(dir: string): void {
  if (existsSync(join(dir, ".git"))) return;
  git(dir, "init");
  git(dir, "config", "user.email", "vishu@local");
  git(dir, "config", "user.name", "vishu");
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "orchestration:init", "--allow-empty");
}

/** Run one subagent in an isolated git worktree with a narrowed policy + tool set, then validate.
 * The worktree is always removed afterward (clean fan-out); harvesting/merging a winning branch is a
 * ponytail ceiling — return value carries the final text the coordinator keeps. */
export async function runSubagent(opts: SubagentOptions): Promise<SubagentOutcome> {
  if (!opts.parentContext.trim()) throw new NoParentContextError();
  ensureRepo(opts.repoDir);

  const branch = `vishu/${opts.archetype.name}-${Math.random().toString(36).slice(2, 8)}`;
  const worktree = join(tmpdir(), `vishu-wt-${Math.random().toString(36).slice(2, 10)}`);
  const add = git(opts.repoDir, "worktree", "add", "-b", branch, worktree);
  if (add.code !== 0) throw new Error(`[orchestration] worktree add failed: ${add.out}`);

  const cleanup = () => {
    git(opts.repoDir, "worktree", "remove", "--force", worktree);
    git(opts.repoDir, "branch", "-D", branch);
  };
  try {
    const tier = narrowTier(opts.parentPolicy.tier, opts.tier ?? opts.parentPolicy.tier);
    const policy: SecurityPolicy = makePolicy(tier, worktree);
    const registry = narrowRegistry(opts.parentRegistry, opts.archetype);
    const baseMessages = [
      { role: "system" as const, content: `${opts.archetype.system}\n\nParent context:\n${opts.parentContext}` },
      { role: "user" as const, content: opts.task },
    ];
    const terminal = sandboxedTerminal(worktree);
    // Fail-closed F0 gate for the subagent: gated classes need an explicit yes (none wired → denied).
    const gate = new ApprovalGate("automatic", opts.ask ?? (async () => false), { actionOf: (n) => registry.getAction(n) });
    // runToolLoop mutates its transcript, so each attempt gets a fresh copy — a retry never inherits a
    // half-written conversation. retry-once: a mid-run crash (provider exhausted, etc.) gets a single
    // clean retry before it propagates to the outer catch (worktree cleanup + throw).
    const runLoop = () =>
      runToolLoop(
        { router: opts.router, registry, policy, terminal, model: opts.model, runLog: opts.runLog, approve: (c) => gate.decide(c), ask: opts.ask },
        baseMessages.map((m) => ({ ...m })),
        opts.maxIterations ?? 6,
      );
    let result: Awaited<ReturnType<typeof runLoop>>;
    try {
      try {
        result = await runLoop();
      } catch (e) {
        opts.runLog?.log("subagent_retry", `${opts.archetype.name} crashed, retrying once: ${e instanceof Error ? e.message : String(e)}`);
        result = await runLoop();
      }
    } finally {
      terminal.close();
    }
    const validation = opts.validate ? await opts.validate(worktree) : { ok: true, output: "no validator" };
    let merged = false;
    if (validation.ok && opts.harvest) merged = harvestBranch(opts.repoDir, worktree, branch, opts.runLog);
    opts.runLog?.log("subagent_done", `${opts.archetype.name} ok=${validation.ok}${merged ? " merged" : ""}`);
    if (!opts.keepWorktree) cleanup();
    return { ok: validation.ok, archetype: opts.archetype.name, final: result.final, validation, worktree, branch, merged, cleanup: opts.keepWorktree ? cleanup : () => {} };
  } catch (e) {
    cleanup(); // an error never leaves a stray worktree behind
    throw e;
  }
}

/** Commit the worktree's work and merge its branch into the action repo. Best-effort: a merge fault
 * (e.g. conflict) is logged and the branch is left for inspection — the caller already has the result.
 * ponytail: --no-ff merge, no conflict resolution; if both branches touch the same files, resolve by
 * hand. Single-winner harvest rarely conflicts (only one branch merges). */
export function harvestBranch(repoDir: string, worktree: string, branch: string, runLog?: RunLog): boolean {
  git(worktree, "add", "-A");
  // Nothing changed (a read-only archetype — researcher/critic — or a no-op run): skip the commit+merge
  // so a read-only dispatch never lands an empty harvest commit (UPGRADES §7). Gating on the actual diff,
  // not the archetype, also covers a writing archetype that happened to change nothing.
  if (!git(worktree, "status", "--porcelain").out.trim()) {
    runLog?.log("branch_harvest", `${branch}: no changes — nothing to harvest`);
    return false;
  }
  git(worktree, "commit", "-m", `vishu: harvest ${branch}`);
  const merge = git(repoDir, "merge", "--no-ff", "--no-edit", branch);
  if (merge.code !== 0) {
    git(repoDir, "merge", "--abort");
    runLog?.log("branch_harvest_conflict", `${branch}: ${merge.out.slice(0, 200)}`);
    return false;
  }
  return true;
}

/** File-level diff of the most recent harvest merge into `repoDir` — what `orchestrate` landed in the
 * sandbox, for the user to review before landing it upstream with the gated dev_commit / dev_push. */
export function mergedDiffStat(repoDir: string): string {
  const d = git(repoDir, "diff", "--stat", "HEAD^1", "HEAD");
  return d.code === 0 ? d.out.trim() || "(no file changes)" : "(merge diff unavailable)";
}

/** Default dev/test validator: run a shell command in the worktree; non-zero exit = branch failed. */
export function commandValidator(command: string): (worktreeDir: string) => Promise<ValidationResult> {
  return async (worktreeDir) => {
    const term = sandboxedTerminal(worktreeDir);
    try {
      const out = await term.exec(command);
      return { ok: out.exitCode === 0, output: out.stdout };
    } finally {
      term.close();
    }
  };
}
