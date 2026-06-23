import type { ToolRegistry } from "../tools/registry.js";
import type { SkillIndex } from "./index.js";
import { runSkill } from "./runtime.js";

/** Register the tier-2/tier-3 skill tools so the agent retrieves descriptors, then loads/runs
 * a skill only on demand (token-frugal). */
export function registerSkillTools(registry: ToolRegistry, index: SkillIndex): void {
  registry.register({
    name: "skill_search",
    description: "Search the skill library; returns matching skill names + one-line descriptions.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (args) => {
      const hits = index.search(String(args.query ?? ""));
      return hits.length ? hits.map((s) => `${s.name}: ${s.description}`).join("\n") : "no matching skills";
    },
  });

  registry.register({
    name: "skill_run",
    description: "Load or run a skill by name (returns its instructions, or its script output).",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    run: async (args, ctx) => {
      const { out } = runSkill(index.get(String(args.name)), ctx.policy.actionDir);
      return out;
    },
  });
}
