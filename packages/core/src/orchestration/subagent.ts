import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Router } from "../providers/router.js";
import type { RunLog } from "../reliability/runlog.js";
import { makePolicy, type SecurityPolicy, type Tier } from "../security/policy.js";
import { runToolLoop } from "../tools/loop.js";
import type { ToolRegistry } from "../tools/registry.js";
import { Terminal } from "../tools/terminal.js";
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
  maxIterations?: number;
  runLog?: RunLog;
}

export interface SubagentOutcome {
  ok: boolean;
  archetype: string;
  final: string;
  validation: ValidationResult;
  worktree: string;
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

  try {
    const tier = narrowTier(opts.parentPolicy.tier, opts.tier ?? opts.parentPolicy.tier);
    const policy: SecurityPolicy = makePolicy(tier, worktree);
    const registry = narrowRegistry(opts.parentRegistry, opts.archetype);
    const messages = [
      { role: "system" as const, content: `${opts.archetype.system}\n\nParent context:\n${opts.parentContext}` },
      { role: "user" as const, content: opts.task },
    ];
    const result = await runToolLoop(
      { router: opts.router, registry, policy, terminal: new Terminal(worktree), model: opts.model, runLog: opts.runLog },
      messages,
      opts.maxIterations ?? 6,
    );
    const validation = opts.validate ? await opts.validate(worktree) : { ok: true, output: "no validator" };
    opts.runLog?.log("subagent_done", `${opts.archetype.name} ok=${validation.ok}`);
    return { ok: validation.ok, archetype: opts.archetype.name, final: result.final, validation, worktree };
  } finally {
    git(opts.repoDir, "worktree", "remove", "--force", worktree);
    git(opts.repoDir, "branch", "-D", branch);
  }
}

/** Default dev/test validator: run a shell command in the worktree; non-zero exit = branch failed. */
export function commandValidator(command: string): (worktreeDir: string) => Promise<ValidationResult> {
  return async (worktreeDir) => {
    const out = await new Terminal(worktreeDir).exec(command);
    return { ok: out.exitCode === 0, output: out.stdout };
  };
}
