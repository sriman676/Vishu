import { appendFileSync, readFileSync } from "node:fs";

/** One timed operation (PAUL span tracing): a provider call or a tool execution. */
export interface SpanRecord {
  ts: number;
  name: string;
  category?: string;
  ms: number;
  ok: boolean;
}

/** Append-only span log at workspaceDir/spans.jsonl. Best-effort — tracing must never break the call. */
export class TraceLog {
  constructor(private readonly file: string) {}
  record(s: SpanRecord): void {
    try {
      appendFileSync(this.file, `${JSON.stringify(s)}\n`);
    } catch {
      /* observability, not correctness — swallow */
    }
  }
}

/** Read the span log back, skipping torn lines. Missing file → empty. */
export function readSpans(file: string): SpanRecord[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: SpanRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as SpanRecord);
    } catch {
      /* skip a half-written tail line */
    }
  }
  return out;
}

/** Times an async op and hands the span to a sink. Absent sink → a no-op wrapper (still runs fn). */
export class Tracer {
  constructor(private readonly sink?: { record(s: SpanRecord): void }) {}
  async span<T>(name: string, fn: () => Promise<T>, category?: string): Promise<T> {
    if (!this.sink) return fn();
    const start = Date.now();
    let ok = true;
    try {
      return await fn();
    } catch (e) {
      ok = false;
      throw e;
    } finally {
      this.sink.record({ ts: start, name, category, ms: Date.now() - start, ok });
    }
  }
}

export interface SpanStat {
  name: string;
  calls: number;
  errors: number;
  totalMs: number;
  p50: number;
  p95: number;
  maxMs: number;
}

function pct(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  return sortedMs[Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length))]!;
}

/** Aggregate spans by name over the last `sinceMs`: call/error counts + p50/p95/max latency. */
export function spanReport(spans: SpanRecord[], sinceMs: number, now = Date.now()): SpanStat[] {
  const rows = spans.filter((s) => s.ts >= now - sinceMs);
  const groups = new Map<string, SpanRecord[]>();
  for (const s of rows) (groups.get(s.name) ?? groups.set(s.name, []).get(s.name)!).push(s);
  const out: SpanStat[] = [];
  for (const [name, g] of groups) {
    const sorted = g.map((s) => s.ms).sort((a, b) => a - b);
    out.push({
      name,
      calls: g.length,
      errors: g.filter((s) => !s.ok).length,
      totalMs: sorted.reduce((a, b) => a + b, 0),
      p50: pct(sorted, 50),
      p95: pct(sorted, 95),
      maxMs: sorted[sorted.length - 1] ?? 0,
    });
  }
  return out.sort((a, b) => b.totalMs - a.totalMs);
}
