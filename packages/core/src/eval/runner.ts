import { parallelMap } from "../util/parallel.js";
import { gradeStatus } from "../reliability/status.js";
import type { EvalReport, EvalResult, EvalTask, Runner } from "./types.js";

/** Run a suite against one runner, grading each answer. A runner that throws scores 0 with the error as
 * detail (never crashes the run). Aggregates pass-rate + mean score. Bounded concurrency via parallelMap. */
export async function runEval(
  suite: EvalTask[],
  runner: Runner,
  opts: { runnerName?: string; concurrency?: number } = {},
): Promise<EvalReport> {
  const results = await parallelMap(
    suite,
    async (task): Promise<EvalResult> => {
      const start = Date.now();
      let output = "";
      let runErr: string | undefined;
      try {
        output = await runner(task.prompt);
      } catch (e) {
        runErr = e instanceof Error ? e.message : String(e);
      }
      const g = runErr ? { passed: false, score: 0, detail: runErr } : task.grade(output);
      const status = g.status ?? gradeStatus(g.passed, g.score, Boolean(runErr));
      return { id: task.id, passed: g.passed, score: g.score, ms: Date.now() - start, detail: g.detail, status };
    },
    opts.concurrency ?? 4,
  );
  const n = results.length || 1;
  return {
    ts: Date.now(),
    runner: opts.runnerName ?? "runner",
    passRate: results.filter((r) => r.passed).length / n,
    meanScore: results.reduce((s, r) => s + r.score, 0) / n,
    results,
  };
}
