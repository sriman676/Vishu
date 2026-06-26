import type { UsageRecord } from "./log.js";

/** Static price table ($ per 1k tokens, input/output). First matching pattern wins; unknown/local
 * models are free. ponytail: a small hand-kept map — refine per provider/model as prices move. */
const PRICES: { match: RegExp; in: number; out: number }[] = [
  { match: /gpt-4o-mini|4o-mini/i, in: 0.00015, out: 0.0006 },
  { match: /gpt-4o|gpt-4\.1/i, in: 0.0025, out: 0.01 },
  { match: /o3-mini|o4-mini/i, in: 0.0011, out: 0.0044 },
  { match: /haiku/i, in: 0.0008, out: 0.004 },
  { match: /sonnet/i, in: 0.003, out: 0.015 },
  { match: /opus/i, in: 0.015, out: 0.075 },
];

/** Models we treat as "big" — a tiny completion here is a model-overkill smell. */
const BIG_MODEL = /gpt-4o(?!-mini)|gpt-4\.1|sonnet|opus/i;
const SMALL_PRICE = { in: 0.00015, out: 0.0006 }; // what overkill calls would cost on a small model

const BLOAT_RATIO = 8; // prompt ≥ 8× completion …
const BLOAT_MIN_PROMPT = 1500; // … and a heavy prompt → context bloat
const OVERKILL_COMPLETION = 64; // a big model asked for a sub-64-token answer

export function priceOf(model: string): { in: number; out: number } {
  return PRICES.find((p) => p.match.test(model)) ?? { in: 0, out: 0 };
}

export function costOf(rec: Pick<UsageRecord, "model" | "promptTokens" | "completionTokens">): number {
  const p = priceOf(rec.model);
  return (rec.promptTokens * p.in + rec.completionTokens * p.out) / 1000;
}

export interface CategoryStat {
  category: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
  pct: number;
  usd: number;
}

export interface WasteItem {
  kind: "context_bloat" | "model_overkill" | "duplicate";
  calls: number;
  tokens: number; // reclaimable tokens (0 when the saving is purely a cheaper model)
  usd: number; // estimated reclaimable spend
  action: string;
}

export interface TokenReport {
  since: number;
  now: number;
  totalCalls: number;
  totalTokens: number;
  totalUsd: number;
  byCategory: CategoryStat[];
  waste: WasteItem[];
  savingsTokens: number;
  savingsUsd: number;
}

/** Aggregate the ledger over the last `sinceMs`: per-category share + waste heuristics + $ savings. */
export function buildReport(records: UsageRecord[], sinceMs: number, now = Date.now()): TokenReport {
  const since = now - sinceMs;
  const rows = records.filter((r) => r.ts >= since);

  const cats = new Map<string, CategoryStat>();
  let totalTokens = 0;
  let totalUsd = 0;
  for (const r of rows) {
    const tokens = r.promptTokens + r.completionTokens;
    totalTokens += tokens;
    totalUsd += costOf(r);
    const c = cats.get(r.category) ?? { category: r.category, calls: 0, promptTokens: 0, completionTokens: 0, tokens: 0, pct: 0, usd: 0 };
    c.calls++;
    c.promptTokens += r.promptTokens;
    c.completionTokens += r.completionTokens;
    c.tokens += tokens;
    c.usd += costOf(r);
    cats.set(r.category, c);
  }
  const byCategory = [...cats.values()].sort((a, b) => b.tokens - a.tokens);
  for (const c of byCategory) c.pct = totalTokens ? (c.tokens / totalTokens) * 100 : 0;

  const waste = wasteItems(rows);
  const savingsTokens = waste.reduce((s, w) => s + w.tokens, 0);
  const savingsUsd = waste.reduce((s, w) => s + w.usd, 0);

  return { since, now, totalCalls: rows.length, totalTokens, totalUsd, byCategory, waste, savingsTokens, savingsUsd };
}

function wasteItems(rows: UsageRecord[]): WasteItem[] {
  const out: WasteItem[] = [];

  // 1) Context bloat: huge prompt feeding a tiny completion → summarize tool results / evict stale turns.
  const bloat = rows.filter((r) => r.promptTokens >= BLOAT_MIN_PROMPT && r.promptTokens >= BLOAT_RATIO * Math.max(r.completionTokens, 1));
  if (bloat.length) {
    let tokens = 0;
    let usd = 0;
    for (const r of bloat) {
      const excess = r.promptTokens - BLOAT_RATIO * r.completionTokens; // reclaimable prompt tokens
      tokens += excess;
      usd += (excess * priceOf(r.model).in) / 1000;
    }
    out.push({ kind: "context_bloat", calls: bloat.length, tokens, usd, action: "summarize tool results / evict stale turns before the call" });
  }

  // 2) Model overkill: trivial answer on a big model → route trivial calls to a small model.
  const overkill = rows.filter((r) => BIG_MODEL.test(r.model) && r.completionTokens > 0 && r.completionTokens <= OVERKILL_COMPLETION);
  if (overkill.length) {
    let usd = 0;
    for (const r of overkill) usd += costOf(r) - (r.promptTokens * SMALL_PRICE.in + r.completionTokens * SMALL_PRICE.out) / 1000;
    out.push({ kind: "model_overkill", calls: overkill.length, tokens: 0, usd: Math.max(usd, 0), action: "route trivial calls to a small model" });
  }

  // 3) Duplicates: identical model+category+promptTokens repeated → cache/dedup (one paid prompt, reuse rest).
  const groups = new Map<string, UsageRecord[]>();
  for (const r of rows) {
    const k = `${r.model}|${r.category}|${r.promptTokens}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  let dupCalls = 0;
  let dupTokens = 0;
  let dupUsd = 0;
  for (const g of groups.values()) {
    const first = g[0];
    if (g.length < 2 || !first) continue;
    const repeats = g.length - 1; // first call is legitimate; the rest are reclaimable
    dupCalls += repeats;
    dupTokens += repeats * first.promptTokens;
    dupUsd += (repeats * first.promptTokens * priceOf(first.model).in) / 1000;
  }
  if (dupCalls) out.push({ kind: "duplicate", calls: dupCalls, tokens: dupTokens, usd: dupUsd, action: "cache/dedup identical prompts" });

  return out;
}

const usd = (n: number): string => `$${n.toFixed(n < 1 ? 4 : 2)}`;

function bar(pct: number, width = 24): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

const WASTE_LABEL: Record<WasteItem["kind"], string> = {
  context_bloat: "Context bloat",
  model_overkill: "Model overkill",
  duplicate: "Repeat / dedup",
};

/** CLI render: where tokens go (bars + %), then where they are wasted and the $ savings on the table. */
export function renderReport(r: TokenReport, days: number): string {
  const lines: string[] = [];
  lines.push(`Token report — last ${days}d  (${r.totalCalls} calls, ${r.totalTokens.toLocaleString()} tokens, ${usd(r.totalUsd)})`);
  lines.push("");
  if (r.byCategory.length === 0) {
    lines.push("  no usage recorded yet — run some turns, then check back.");
    return lines.join("\n");
  }
  lines.push("Where tokens go");
  const pad = Math.max(...r.byCategory.map((c) => c.category.length));
  for (const c of r.byCategory) {
    lines.push(`  ${c.category.padEnd(pad)}  ${bar(c.pct)} ${c.pct.toFixed(1).padStart(5)}%  ${c.tokens.toLocaleString().padStart(9)} tok  ${usd(c.usd)}`);
  }
  lines.push("");
  if (r.waste.length === 0) {
    lines.push("Where it's wasted: nothing flagged. 🎉");
  } else {
    lines.push(`Where it's wasted — est. savings ${usd(r.savingsUsd)} / ${r.savingsTokens.toLocaleString()} tokens`);
    for (const w of r.waste) {
      const reclaim = w.tokens ? `${w.tokens.toLocaleString()} tok` : usd(w.usd);
      lines.push(`  ${WASTE_LABEL[w.kind].padEnd(15)} ${String(w.calls).padStart(4)} call(s)  ~${reclaim.padStart(10)}  → ${w.action}`);
    }
  }
  return lines.join("\n");
}
