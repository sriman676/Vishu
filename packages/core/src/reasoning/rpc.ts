import type { Router } from "../providers/router.js";
import { err, ok, type Registry } from "../transport/rpc.js";
import { bestOfN } from "./selfconsistency.js";

/** `vishu.reasoning_best_of_n` — sample N candidates and return the selected answer + full ballot. */
export function registerReasoning(registry: Registry, deps: { router: Router; model: string }): void {
  registry.register("vishu.reasoning_best_of_n", async (params) => {
    const p = (params ?? {}) as { prompt?: string; n?: number; select?: string };
    if (!p.prompt) return err("invalid_params", "prompt is required");
    const res = await bestOfN(deps.router, deps.model, p.prompt, {
      n: typeof p.n === "number" ? p.n : undefined,
      select: p.select === "judge" ? "judge" : "vote",
    });
    return ok(res);
  });
}
