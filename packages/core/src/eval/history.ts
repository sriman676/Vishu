import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EvalReport } from "./types.js";

interface HistoryRow {
  ts: number;
  runner: string;
  passRate: number;
  meanScore: number;
}

export interface Trend {
  runs: number;
  latest: number;
  previous?: number;
  /** latest mean score − previous (same runner); undefined on the first run. */
  delta?: number;
}

/** Append-only JSONL of past eval runs — the "over time" axis. One summary row per run. */
export class EvalHistory {
  constructor(private readonly file: string) {}

  record(report: EvalReport): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const row: HistoryRow = { ts: report.ts, runner: report.runner, passRate: report.passRate, meanScore: report.meanScore };
    appendFileSync(this.file, `${JSON.stringify(row)}\n`);
  }

  all(): HistoryRow[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as HistoryRow);
  }

  /** Latest mean score vs the previous run's, for a runner (or across all runs when unspecified). */
  trend(runner?: string): Trend {
    const rows = this.all().filter((r) => !runner || r.runner === runner);
    const latest = rows.at(-1);
    const previous = rows.at(-2);
    return {
      runs: rows.length,
      latest: latest?.meanScore ?? 0,
      previous: previous?.meanScore,
      delta: latest && previous ? latest.meanScore - previous.meanScore : undefined,
    };
  }
}
