import type { Router } from "../providers/router.js";
import { err, ok, type Registry } from "../transport/rpc.js";
import { EvalHistory } from "./history.js";
import { runEval } from "./runner.js";
import { makeRunners } from "./runners.js";
import { BUILTIN_SUITE } from "./suite.js";

/** `vishu.eval_run` (run the built-in suite against a chosen runner, record history) + `vishu.eval_trend`. */
export function registerEval(registry: Registry, deps: { router: Router; model: string; historyFile: string }): void {
  const runners = makeRunners(deps.router, deps.model);
  const history = new EvalHistory(deps.historyFile);

  registry.register("vishu.eval_run", async (params) => {
    const name = (params as { runner?: string } | undefined)?.runner ?? "effort";
    const runner = runners[name];
    if (!runner) return err("invalid_params", `unknown runner '${name}' (have: ${Object.keys(runners).join(", ")})`);
    const report = await runEval(BUILTIN_SUITE, runner, { runnerName: name });
    history.record(report);
    return ok({ report, trend: history.trend(name) });
  });

  registry.register("vishu.eval_trend", (params) => ok(history.trend((params as { runner?: string } | undefined)?.runner)));
}
