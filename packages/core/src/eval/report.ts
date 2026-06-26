import type { Trend } from "./history.js";
import type { EvalReport } from "./types.js";

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** Plain-text scorecard for the CLI: headline pass-rate/mean, per-task lines, and the trend vs last run. */
export function renderEval(report: EvalReport, trend?: Trend): string {
  const lines = [
    `[eval] ${report.runner}: pass ${pct(report.passRate)}, mean ${report.meanScore.toFixed(2)} (${report.results.length} tasks)`,
    ...report.results.map((r) => `  ${r.passed ? "✓" : "✗"} ${r.id}  ${r.score.toFixed(2)}  ${r.ms}ms${r.detail ? `  — ${r.detail}` : ""}`),
  ];
  if (trend?.delta !== undefined) {
    lines.push(`  trend: ${trend.delta >= 0 ? "+" : ""}${trend.delta.toFixed(2)} vs previous (${trend.runs} runs)`);
  }
  return lines.join("\n");
}
