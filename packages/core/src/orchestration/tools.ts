import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { Coordinator } from "./coordinator.js";
import type { AgentFactory } from "./factory.js";
import type { RoleRegistry } from "./roles.js";

/** Expose orchestration as a tool so the main agent can fan a goal out to subagents. The coder
 * archetype (used per branch) excludes `orchestrate`, so subagents can't recurse into orchestration.
 * Branch building dispatches through the "builder" role, so a configured builder-AI is used when set.
 * When a `factory` is supplied, `create_agent` (gated) and `dispatch` (route+run one task) close the
 * Step 5 loop: a bespoke agent can be built at runtime and then routed to by name. */
export function registerOrchestrationTools(registry: ToolRegistry, deps: { roles: RoleRegistry; model: string; factory?: AgentFactory }): void {
  const coordinator = (ctx: ToolContext) =>
    new Coordinator({
      router: deps.roles.for("builder"),
      model: deps.roles.modelFor("builder") ?? deps.model, // the builder role's pinned model (e.g. large NIM)
      parentPolicy: ctx.policy,
      parentRegistry: registry,
      repoDir: ctx.policy.actionDir,
      factory: deps.factory,
      ask: ctx.ask, // a dispatched/orchestrated subagent can now request approval, not just deny
    });

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
      const result = await coordinator(ctx).run(String(args.goal ?? ""), {
        validateCommand: args.validateCommand ? String(args.validateCommand) : undefined,
      });
      return result.final;
    },
  });

  if (!deps.factory) return;
  const factory = deps.factory;

  registry.register({
    name: "create_agent",
    // The factory's own change_setting gate is the single approval here; the tool itself is a plain write.
    meta: { action: "write" },
    description: "Build a bespoke sub-agent for a task (least-privilege tools ⊆ current tools, cited skills). Registration is gated; once approved the agent is routable by `dispatch`.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, task: { type: "string", description: "What this agent is for — drives its skills, prompt, and toolset." } },
      required: ["name", "task"],
    },
    run: async (args) => {
      const proposal = factory.propose(String(args.name ?? ""), String(args.task ?? ""));
      const res = await factory.approveAndRegister(proposal);
      if (!res.registered) return `Not registered: ${res.reason ?? "denied"}.`;
      return `Registered agent "${proposal.name}" (tools: ${proposal.tools.join(", ") || "read-only core"}; wishlist: ${proposal.toolWishlist.join(", ") || "none"}).`;
    },
  });

  registry.register({
    name: "list_agents",
    meta: { action: "read" },
    description: "List the bespoke agents approved by the factory — name, granted tools, and each one's outstanding tool-wishlist.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const agents = factory.agents();
      if (!agents.length) return "No bespoke agents registered.";
      return agents
        .map((a) => {
          const tools = a.tools === "inherit" ? "(inherits all)" : a.tools.join(", ") || "read-only core";
          const wish = a.wishlist?.length ? `; wishlist: ${a.wishlist.join(", ")}` : "";
          return `- ${a.name} — tools: ${tools}${wish}`;
        })
        .join("\n");
    },
  });

  registry.register({
    name: "revoke_agent",
    meta: { action: "write" }, // the factory's change_setting gate is the real approval
    description: "Remove an approved bespoke agent so it is no longer routable. Revocation is gated.",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    run: async (args) => {
      const res = await factory.revoke(String(args.name ?? ""));
      return res.removed ? `Revoked agent "${args.name}".` : `Not revoked: ${res.reason ?? "denied"}.`;
    },
  });

  registry.register({
    name: "grant_tool",
    meta: { action: "write" }, // the factory's change_setting gate is the real approval
    description: "Fulfil a wishlist item: grant a system tool to a bespoke agent (gated). Only tools the system already exposes can be granted (add the tool first, then grant).",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, tool: { type: "string" } },
      required: ["name", "tool"],
    },
    run: async (args) => {
      const res = await factory.grantTool(String(args.name ?? ""), String(args.tool ?? ""));
      return res.granted ? `Granted "${args.tool}" to agent "${args.name}".` : `Not granted: ${res.reason ?? "denied"}.`;
    },
  });

  registry.register({
    name: "dispatch",
    // Routing/delegation is a write; the dispatched subagent gates its own side effects. Explicit so the
    // name heuristic (which reads "dispatch" as send) doesn't force a spurious prompt on every route.
    meta: { action: "write" },
    description: "Route ONE task to the best executor — an approved bespoke agent (named in the task), a preset role, or a synthesized agent — and run it. A too-vague task returns a clarifying question.",
    parameters: { type: "object", properties: { task: { type: "string" } }, required: ["task"] },
    run: async (args, ctx) => coordinator(ctx).dispatchAndRun(String(args.task ?? "")),
  });
}
