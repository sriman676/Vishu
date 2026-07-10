import type { Router } from "../providers/router.js";
import type { AskFn } from "../reliability/approvals.js";
import type { RunLog } from "../reliability/runlog.js";
import type { SecurityPolicy } from "../security/policy.js";
import type { ToolRegistry } from "../tools/registry.js";
import { parallelMap } from "../util/parallel.js";
import { ARCHETYPES, type Archetype, synthesizeArchetype } from "./archetypes.js";
import { commandValidator, harvestBranch, runSubagent, type ValidationResult } from "./subagent.js";

type SubagentOutcome = Awaited<ReturnType<typeof runSubagent>>;

export interface CoordinatorDeps {
  router: Router;
  model: string;
  parentPolicy: SecurityPolicy;
  parentRegistry: ToolRegistry;
  repoDir: string;
  runLog?: RunLog;
  /** Approve subagents' gated actions (UPGRADES §4). Absent → deny-only (fail-closed): a supervised
   * orchestration can pass a real ask so a subagent requests approval instead of only being blocked. */
  ask?: AskFn;
  /** Extended-thinking budget for the orchestrator's own decision calls (hypothesis/dispatch routing).
   * Applies to the coordinator's reasoning only — never handed to subagents' tool loops. */
  thinkingBudget?: number;
}

export interface CoordinatorOptions {
  maxBranches?: number;
  /** Per-branch dev/test validation. A command string runs in each worktree; a function lets tests
   * decide pass/fail per hypothesis. Absent = branches auto-pass (first one wins). */
  validateCommand?: string;
  validate?: (hypothesis: string, worktreeDir: string) => Promise<ValidationResult>;
  /** Merge the winning branch back into the action repo (default true). */
  harvest?: boolean;
  /** Race all hypotheses concurrently instead of one-at-a-time. Faster; the winner is merged back in a
   * single serial step after the race, and failed-branch lessons are backpropagated into the result. */
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

/** How `dispatch` routes an intent to a preset archetype. First rule that matches wins, so order is
 * specificity: review/test before build, build before research, research before plan. */
const PRESET_RULES: [RegExp, string][] = [
  [/\b(review|audit|critique|test|verify|check)\b/, "critic"],
  [/\b(implement|build|code|write|fix|refactor|create|add|edit)\b/, "coder"],
  [/\b(research|investigate|gather|find out|look up|summar)\b/, "researcher"],
  [/\b(plan|design|outline|break down|steps)\b/, "planner"],
];

/** The routing outcome for a single task: a preset/synthesized archetype to execute, or a clarifying
 * question when the task is too vague to act on. (A `mode` arm — interview/teacher/… personas — lands in
 * Phase 4 when orchestration/modes.ts exists; deferred here, not invented.) */
export type DispatchDecision =
  | { kind: "archetype"; archetype: Archetype }
  | { kind: "synthesized"; archetype: Archetype }
  | { kind: "clarify"; question: string };

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

  /** Route ONE task to an executor without fanning out: a preset archetype when the intent clearly matches
   * one, a synthesized archetype for a novel task, or a single clarifying question when the task is too
   * vague to act on. Deterministic keyword routing — ponytail ceiling: an LLM classifier is the upgrade
   * path when the rules misroute. Mode routing is deferred to Phase 4 (see DispatchDecision). */
  dispatch(task: string): DispatchDecision {
    const words = task.trim().split(/\s+/).filter(Boolean);
    if (words.length < 3) {
      return { kind: "clarify", question: `"${task.trim()}" is too brief to route — tell me the goal and any target (file, repo, or topic).` };
    }
    const lower = task.toLowerCase();
    for (const [re, name] of PRESET_RULES) {
      if (re.test(lower)) return { kind: "archetype", archetype: ARCHETYPES[name]! };
    }
    return { kind: "synthesized", archetype: synthesizeArchetype(task, this.deps.parentRegistry) };
  }

  async run(goal: string, opts: CoordinatorOptions = {}): Promise<OrchestrationResult> {
    const max = opts.maxBranches ?? 3;
    const res = await this.deps.router.chat({
      model: this.deps.model,
      messages: [
        { role: "system", content: "Propose distinct approaches, one per line, no prose." },
        { role: "user", content: `List up to ${max} distinct approaches to accomplish:\n${goal}` },
      ],
      category: "orchestration",
      ...(this.deps.thinkingBudget ? { thinking: { budgetTokens: this.deps.thinkingBudget } } : {}),
    });
    const hypotheses = parseHypotheses(res.content, max);
    if (hypotheses.length === 0) hypotheses.push(goal); // degrade: treat the goal itself as the one branch

    return opts.parallel ? this.runParallel(goal, hypotheses, opts) : this.runSequential(goal, hypotheses, opts);
  }

  /** Run one hypothesis as an isolated subagent. `learnings` (sequential only) are fed in as context. */
  private async runBranch(goal: string, hypothesis: string, learnings: string[], opts: CoordinatorOptions, harvest: boolean, keepWorktree = false): Promise<{ branch: BranchResult; outcome: SubagentOutcome }> {
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
      ask: this.deps.ask,
      harvest,
      keepWorktree,
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

  /** Opt-in: race all hypotheses concurrently (bounded), each in a kept worktree (no merge during the
   * race). Afterward the winner (first PASS by order) is merged back in a single serial step — safe,
   * since only one merge runs — and the failed branches' lessons are backpropagated into the final
   * result. All kept worktrees are then cleaned up.
   * ponytail ceiling that remains: concurrent `git worktree add` can still race at high concurrency. */
  private async runParallel(goal: string, hypotheses: string[], opts: CoordinatorOptions): Promise<OrchestrationResult> {
    const results = await parallelMap(hypotheses, (h) => this.runBranch(goal, h, [], opts, false, true), opts.concurrency ?? hypotheses.length);
    const branches = results.map((r) => r.branch);
    const learnings = results.filter((r) => !r.branch.ok).map((r) => `Tried "${r.branch.hypothesis}": failed validation — ${r.branch.output.slice(0, 200)}`);
    const winner = results.find((r) => r.branch.ok);
    try {
      if (!winner) return { ok: false, final: `All ${branches.length} approach(es) failed.\n${learnings.join("\n")}`, branches, learnings, merged: false };
      const merged = (opts.harvest ?? true) ? harvestBranch(this.deps.repoDir, winner.outcome.worktree, winner.outcome.branch, this.deps.runLog) : false;
      this.deps.runLog?.log("branch_harvest", `${winner.branch.hypothesis} (parallel${(opts.harvest ?? true) ? (merged ? "; merged" : "; merge failed") : ""})`);
      const final = learnings.length ? `${winner.branch.final}\n\n(Cross-branch learnings:\n${learnings.join("\n")})` : winner.branch.final;
      return { ok: true, final, chosen: winner.branch.hypothesis, branches, learnings, merged };
    } finally {
      for (const r of results) r.outcome.cleanup(); // winner already merged; discard every kept worktree
    }
  }
}
