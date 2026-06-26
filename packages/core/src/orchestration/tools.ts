import type { ToolRegistry } from "../tools/registry.js";
import { Coordinator } from "./coordinator.js";
import type { RoleRegistry } from "./roles.js";

/** Expose orchestration as a tool so the main agent can fan a goal out to subagents. The coder
 * archetype (used per branch) excludes `orchestrate`, so subagents can't recurse into orchestration.
 * Branch building dispatches through the "builder" role, so a configured builder-AI is used when set. */
export function registerOrchestrationTools(registry: ToolRegistry, deps: { roles: RoleRegistry; model: string }): void {
  registry.register({
    name: "orchestrate",
    description: "Decompose a goal into distinct approaches, try each as an isolated subagent, prune failures, and return one result.",
    parameters: {
      type: "object",
      properties: {
        goal: { type: "string" },
        validateCommand: { type: "string", description: "Optional shell command run in each worktree to validate the branch (non-zero exit = pruned)." },
      },
      required: ["goal"],
    },
    run: async (args, ctx) => {
      const coordinator = new Coordinator({
        router: deps.roles.for("builder"),
        model: deps.model,
        parentPolicy: ctx.policy,
        parentRegistry: registry,
        repoDir: ctx.policy.actionDir,
      });
      const result = await coordinator.run(String(args.goal ?? ""), {
        validateCommand: args.validateCommand ? String(args.validateCommand) : undefined,
      });
      return result.final;
    },
  });
}
