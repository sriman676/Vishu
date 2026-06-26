import type { Router } from "../providers/router.js";
import type { RunLog } from "../reliability/runlog.js";
import type { SecurityPolicy } from "../security/policy.js";
import type { ToolRegistry } from "../tools/registry.js";
import { parallelMap } from "../util/parallel.js";
import { ARCHETYPES } from "./archetypes.js";
import { commandValidator, runSubagent, type ValidationResult } from "./subagent.js";

type SubagentOutcome = Awaited<ReturnType<typeof runSubagent>>;

export interface CoordinatorDeps {
  router: Router;
  model: string;
  parentPolicy: SecurityPolicy;
  parentRegistry: ToolRegistry;
  repoDir: string;
  runLog?: RunLog;
}

export interface CoordinatorOptions {
  maxBranches?: number;
  /** Per-branch dev/test validation. A command string runs in each worktree; a function lets tests
   * decide pass/fail per hypothesis. Absent = branches auto-pass (first one wins). */
  validateCommand?: string;
  validate?: (hypothesis: string, worktreeDir: string) => Promise<ValidationResult>;
  /** Merge the winning branch back into the action repo (default true). */
  harvest?: boolean;
  /** Race all hypotheses concurrently instead of one-at-a-time. Faster, but no learning backpropagation
   * between branches, and the winner is NOT auto-merged (concurrent git merges into one repo race). */
  parallel?: boolean;
  /** Max branches in flight at once when `parallel` (default: all of them). */
  concurrency?: number;
}

export interface BranchResult {
  hypothesis: string;
  ok: boolean;
  final: string;
  output: string;
}

export interface OrchestrationResult {
  ok: boolean;
  final: string;
  chosen?: string;
  branches: BranchResult[];
  /** Lessons harvested from pruned branches, backpropagated into later branches and the final answer. */
  learnings: string[];
  /** True if the chosen branch's changes were merged back into the action repo. */
  merged: boolean;
}

/** Strip "1. ", "- ", "* " and blanks; the provider's free-text list → discrete hypotheses. */
function parseHypotheses(text: string, max: number): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim())
    .filter(Boolean);
  return lines.slice(0, max);
}

/** Coordinator/Executor with a hypothesis tree: propose approaches, run each as an isolated subagent
 * (Executor), prune branches that fail validation, harvest the first that passes, and backpropagate
 * pruned-branch learnings into later branches and the final result. Returns one result. */
export class Coordinator {
  constructor(private readonly deps: CoordinatorDeps) {}

  async run(goal: string, opts: CoordinatorOptions = {}): Promise<OrchestrationResult> {
    const max = opts.maxBranches ?? 3;
    const res = await this.deps.router.chat({
      model: this.deps.model,
      messages: [
        { role: "system", content: "Propose distinct approaches, one per line, no prose." },
        { role: "user", content: `List up to ${max} distinct approaches to accomplish:\n${goal}` },
      ],
      category: "orchestration",
    });
    const hypotheses = parseHypotheses(res.content, max);
    if (hypotheses.length === 0) hypotheses.push(goal); // degrade: treat the goal itself as the one branch

    return opts.parallel ? this.runParallel(goal, hypotheses, opts) : this.runSequential(goal, hypotheses, opts);
  }

  /** Run one hypothesis as an isolated subagent. `learnings` (sequential only) are fed in as context. */
  private async runBranch(goal: string, hypothesis: string, learnings: string[], opts: CoordinatorOptions, harvest: boolean): Promise<{ branch: BranchResult; outcome: SubagentOutcome }> {
    this.deps.runLog?.log("branch_start", hypothesis);
    const context = [`Goal: ${goal}`, ...(learnings.length ? ["Learnings from failed approaches:", ...learnings] : [])].join("\n");
    const outcome = await runSubagent({
      archetype: ARCHETYPES.coder!,
      task: `${goal}\n\nApproach: ${hypothesis}`,
      parentContext: context,
      parentPolicy: this.deps.parentPolicy,
      parentRegistry: this.deps.parentRegistry,
      router: this.deps.router,
      model: this.deps.model,
      repoDir: this.deps.repoDir,
      runLog: this.deps.runLog,
      harvest,
      validate: opts.validate
        ? (wt) => opts.validate!(hypothesis, wt)
        : opts.validateCommand
          ? commandValidator(opts.validateCommand)
          : undefined,
    });
    return { branch: { hypothesis, ok: outcome.ok, final: outcome.final, output: outcome.validation.output }, outcome };
  }

  /** Default: try approaches one-at-a-time, prune failures into learnings, harvest the first that passes. */
  private async runSequential(goal: string, hypotheses: string[], opts: CoordinatorOptions): Promise<OrchestrationResult> {
    const branches: BranchResult[] = [];
    const learnings: string[] = [];
    for (const hypothesis of hypotheses) {
      const { branch, outcome } = await this.runBranch(goal, hypothesis, learnings, opts, opts.harvest ?? true);
      branches.push(branch);
      if (outcome.ok) {
        this.deps.runLog?.log("branch_harvest", `${hypothesis}${outcome.merged ? " (merged)" : ""}`);
        const final = learnings.length ? `${outcome.final}\n\n(Backpropagated learnings:\n${learnings.join("\n")})` : outcome.final;
        return { ok: true, final, chosen: hypothesis, branches, learnings, merged: outcome.merged };
      }
      const lesson = `Tried "${hypothesis}": failed validation — ${outcome.validation.output.slice(0, 200)}`;
      learnings.push(lesson);
      this.deps.runLog?.log("branch_prune", lesson);
    }
    return { ok: false, final: `All ${branches.length} approach(es) failed.\n${learnings.join("\n")}`, branches, learnings, merged: false };
  }

  /** Opt-in: race all hypotheses concurrently (bounded). No learning backprop; the winner (first PASS by
   * order) is reported but NOT merged — concurrent git merges into one repo race. ponytail: auto-merging
   * the parallel winner afterward is the named upgrade; use sequential mode when you need the auto-merge. */
  private async runParallel(goal: string, hypotheses: string[], opts: CoordinatorOptions): Promise<OrchestrationResult> {
    const results = await parallelMap(hypotheses, (h) => this.runBranch(goal, h, [], opts, false), opts.concurrency ?? hypotheses.length);
    const branches = results.map((r) => r.branch);
    const learnings = results.filter((r) => !r.branch.ok).map((r) => `Tried "${r.branch.hypothesis}": failed validation — ${r.branch.output.slice(0, 200)}`);
    const winner = results.find((r) => r.branch.ok);
    if (winner) {
      this.deps.runLog?.log("branch_harvest", `${winner.branch.hypothesis} (parallel; not merged)`);
      return { ok: true, final: winner.branch.final, chosen: winner.branch.hypothesis, branches, learnings, merged: false };
    }
    return { ok: false, final: `All ${branches.length} approach(es) failed.\n${learnings.join("\n")}`, branches, learnings, merged: false };
  }
}
