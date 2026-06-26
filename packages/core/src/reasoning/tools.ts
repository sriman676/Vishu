import type { Router } from "../providers/router.js";
import type { ToolRegistry } from "../tools/registry.js";
import { effortRoute } from "./effort.js";
import { bestOfN, type SelectMethod } from "./selfconsistency.js";

/** Expose self-consistency as a tool so the agent can spend test-time compute on a hard sub-question:
 * sample N answers and return the majority (or judge-picked) one instead of a single risky call. */
export function registerReasoningTools(registry: ToolRegistry, deps: { router: Router; model: string }): void {
  registry.register({
    name: "solve",
    description: "Answer a question with effort matched to its difficulty: a single call for trivial, self-consistency for medium, a multi-agent ensemble for hard. Use for any question where reliability matters.",
    parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
    run: async (args) => (await effortRoute(deps.router, deps.model, String(args.prompt ?? ""))).answer,
  });
  registry.register({
    name: "best_of_n",
    description: "Answer a question more reliably by sampling several candidates and selecting one by majority vote (default) or a judge model.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        n: { type: "number", description: "Number of samples (default 5)." },
        select: { type: "string", enum: ["vote", "judge"], description: "Selection method (default vote)." },
      },
      required: ["prompt"],
    },
    run: async (args) => {
      const res = await bestOfN(deps.router, deps.model, String(args.prompt ?? ""), {
        n: typeof args.n === "number" ? args.n : undefined,
        select: args.select === "judge" ? "judge" : ("vote" as SelectMethod),
      });
      return res.chosen;
    },
  });
}
