import { readFileSync } from "node:fs";
import type { DecisionEntry } from "../reliability/autonomy.js";
import { type SpanRecord, type SpanStat, spanReport } from "../reliability/trace.js";
import { readUsage } from "./log.js";
import { costOf } from "./report.js";

/** Unified ledger event (PAUL): the token ledger and the decision log, merged and timestamped. */
export type LedgerEvent =
  | { ts: number; kind: "tokens"; model: string; category: string; promptTokens: number; completionTokens: number; usd: number }
  | { ts: number; kind: "decision"; actionClass: string; signature: string; allowed: boolean };

/** Read the decision log (JSONL), skipping torn lines. Missing file → empty. Mirrors readUsage. */
function readDecisions(file: string): DecisionEntry[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: DecisionEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as DecisionEntry);
    } catch {
      /* skip a half-written tail line */
    }
  }
  return out;
}

/** Merge token usage + gate decisions into one timestamped stream, oldest first. */
export function readLedger(usageFile: string, decisionFile: string): LedgerEvent[] {
  const tokens = readUsage(usageFile).map<LedgerEvent>((r) => ({
    ts: r.ts,
    kind: "tokens",
    model: r.model,
    category: r.category,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    usd: costOf(r),
  }));
  const decisions = readDecisions(decisionFile).map<LedgerEvent>((d) => ({
    ts: d.ts,
    kind: "decision",
    actionClass: d.actionClass,
    signature: d.signature,
    allowed: d.allowed,
  }));
  return [...tokens, ...decisions].sort((a, b) => a.ts - b.ts);
}

export interface TurnStat {
  start: number;
  end: number;
  calls: number;
  tokens: number;
  usd: number;
  decisions: number;
  denied: number;
}

// ponytail: turns are inferred by an idle gap, not an explicit id — the two source logs carry none.
// Thread a turn/session id through the router + gate if you need exact boundaries under concurrency.
const TURN_GAP_MS = 60_000;

/** Segment the merged stream into turns: a gap ≥ gapMs since the last event starts a new turn. */
export function turns(events: LedgerEvent[], gapMs = TURN_GAP_MS): TurnStat[] {
  const out: TurnStat[] = [];
  let cur: TurnStat | undefined;
  for (const e of events) {
    if (!cur || e.ts - cur.end > gapMs) {
      cur = { start: e.ts, end: e.ts, calls: 0, tokens: 0, usd: 0, decisions: 0, denied: 0 };
      out.push(cur);
    }
    cur.end = e.ts;
    if (e.kind === "tokens") {
      cur.calls++;
      cur.tokens += e.promptTokens + e.completionTokens;
      cur.usd += e.usd;
    } else {
      cur.decisions++;
      if (!e.allowed) cur.denied++;
    }
  }
  return out;
}

export interface LedgerReport {
  since: number;
  now: number;
  totalUsd: number;
  totalTokens: number;
  totalCalls: number;
  totalDecisions: number;
  totalDenied: number;
  turns: TurnStat[];
  /** Per-operation latency (router.chat + tool:*), empty when no spans were traced. */
  spans: SpanStat[];
}

/** Aggregate the merged ledger over the last `sinceMs`, with per-turn cost attribution + span latency. */
export function ledgerReport(events: LedgerEvent[], sinceMs: number, now = Date.now(), spans: SpanRecord[] = []): LedgerReport {
  const since = now - sinceMs;
  const rows = events.filter((e) => e.ts >= since);
  const ts = turns(rows);
  return {
    since,
    now,
    totalUsd: ts.reduce((s, t) => s + t.usd, 0),
    totalTokens: ts.reduce((s, t) => s + t.tokens, 0),
    totalCalls: ts.reduce((s, t) => s + t.calls, 0),
    totalDecisions: ts.reduce((s, t) => s + t.decisions, 0),
    totalDenied: ts.reduce((s, t) => s + t.denied, 0),
    turns: ts,
    spans: spanReport(spans, sinceMs, now),
  };
}

const usd = (n: number): string => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/** CLI render: header totals then a per-turn table (time, calls, tokens, $, decisions/denied). */
export function renderLedger(r: LedgerReport, days: number): string {
  const lines: string[] = [];
  lines.push(
    `Ledger — last ${days}d  (${r.turns.length} turns, ${r.totalCalls} calls, ${r.totalTokens.toLocaleString()} tokens, ${usd(r.totalUsd)}, ${r.totalDecisions} decisions / ${r.totalDenied} denied)`,
  );
  if (r.turns.length === 0) {
    lines.push("  nothing recorded yet — run some turns, then check back.");
    return lines.join("\n");
  }
  lines.push("");
  lines.push("  when                 calls    tokens        $   dec/deny");
  for (const t of r.turns) {
    const when = new Date(t.start).toISOString().slice(0, 19).replace("T", " ");
    lines.push(
      `  ${when}  ${String(t.calls).padStart(5)}  ${t.tokens.toLocaleString().padStart(9)}  ${usd(t.usd).padStart(7)}   ${t.decisions}/${t.denied}`,
    );
  }
  if (r.spans.length) {
    lines.push("");
    lines.push("Where time goes            calls   p50    p95    max");
    for (const s of r.spans) {
      const err = s.errors ? ` (${s.errors} err)` : "";
      lines.push(`  ${s.name.padEnd(24)} ${String(s.calls).padStart(5)}  ${ms(s.p50)}  ${ms(s.p95)}  ${ms(s.maxMs)}${err}`);
    }
  }
  return lines.join("\n");
}

const ms = (n: number): string => `${n}ms`.padStart(6);
