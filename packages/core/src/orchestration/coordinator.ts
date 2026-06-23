import type { Router } from "../providers/router.js";
import type { RunLog } from "../reliability/runlog.js";
import type { SecurityPolicy } from "../security/policy.js";
import type { ToolRegistry } from "../tools/registry.js";
import { ARCHETYPES } from "./archetypes.js";
import { commandValidator, runSubagent, type ValidationResult } from "./subagent.js";

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
    });
    const hypotheses = parseHypotheses(res.content, max);
    if (hypotheses.length === 0) hypotheses.push(goal); // degrade: treat the goal itself as the one branch

    const branches: BranchResult[] = [];
    const learnings: string[] = [];

    for (const hypothesis of hypotheses) {
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
        harvest: opts.harvest ?? true,
        validate: opts.validate
          ? (wt) => opts.validate!(hypothesis, wt)
          : opts.validateCommand
            ? commandValidator(opts.validateCommand)
            : undefined,
      });
      branches.push({ hypothesis, ok: outcome.ok, final: outcome.final, output: outcome.validation.output });

      if (outcome.ok) {
        this.deps.runLog?.log("branch_harvest", `${hypothesis}${outcome.merged ? " (merged)" : ""}`);
        const final = learnings.length ? `${outcome.final}\n\n(Backpropagated learnings:\n${learnings.join("\n")})` : outcome.final;
        return { ok: true, final, chosen: hypothesis, branches, learnings, merged: outcome.merged };
      }

      // prune: record why so later branches (and the caller) learn from it.
      const lesson = `Tried "${hypothesis}": failed validation — ${outcome.validation.output.slice(0, 200)}`;
      learnings.push(lesson);
      this.deps.runLog?.log("branch_prune", lesson);
    }

    return {
      ok: false,
      final: `All ${branches.length} approach(es) failed.\n${learnings.join("\n")}`,
      branches,
      learnings,
      merged: false,
    };
  }
}
