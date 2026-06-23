import { spawnSync } from "node:child_process";

/**
 * Git-backed checkpoints for undo. ponytail: commit/reset snapshots cover "make a risky edit
 * undoable". Worktree-level isolation (parallel branches) is Phase 8's job.
 */
export class Checkpoints {
  constructor(private readonly dir: string) {}

  private git(...args: string[]): { code: number; out: string } {
    const r = spawnSync("git", args, { cwd: this.dir, encoding: "utf8" });
    return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  /** Initialise a repo (idempotent) so snapshots have somewhere to live. */
  init(): void {
    this.git("init");
    this.git("config", "user.email", "vishu@local");
    this.git("config", "user.name", "vishu");
    this.git("add", "-A");
    this.git("commit", "-m", "checkpoint:init", "--allow-empty");
  }

  /** Snapshot the working tree; returns the commit hash to undo to later. */
  snapshot(label: string): string {
    this.git("add", "-A");
    this.git("commit", "-m", `checkpoint:${label}`, "--allow-empty");
    return this.head();
  }

  head(): string {
    return this.git("rev-parse", "HEAD").out.trim();
  }

  /** Restore the working tree to a prior snapshot. */
  undoTo(hash: string): void {
    this.git("reset", "--hard", hash);
  }
}
