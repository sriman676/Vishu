import assert from "node:assert/strict";
import { test } from "node:test";
import type { UsageRecord } from "./log.js";
import { buildReport, costOf, priceOf, renderReport } from "./report.js";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  ts: NOW,
  model: "gpt-4o-mini",
  category: "agent",
  promptTokens: 100,
  completionTokens: 100,
  ...over,
});

test("aggregates per-category share to 100%", () => {
  const r = buildReport(
    [rec({ category: "agent", promptTokens: 300, completionTokens: 100 }), rec({ category: "orchestration", promptTokens: 100, completionTokens: 0 })],
    7 * DAY,
    NOW,
  );
  assert.equal(r.totalTokens, 500);
  assert.equal(r.byCategory[0].category, "agent"); // sorted by tokens desc
  assert.equal(r.byCategory[0].tokens, 400);
  assert.equal(Math.round(r.byCategory.reduce((s, c) => s + c.pct, 0)), 100);
  assert.equal(r.byCategory[0].pct, 80);
});

test("excludes records outside the window", () => {
  const r = buildReport([rec({ ts: NOW - 10 * DAY }), rec({ ts: NOW - DAY })], 7 * DAY, NOW);
  assert.equal(r.totalCalls, 1);
});

test("price table charges by model and is free for unknown/local models", () => {
  assert.ok(priceOf("claude-3-5-sonnet-latest").out > priceOf("gpt-4o-mini").out);
  assert.equal(priceOf("llama3.2").in, 0);
  assert.equal(costOf({ model: "llama3.2", promptTokens: 1000, completionTokens: 1000 }), 0);
  assert.ok(Math.abs(costOf({ model: "gpt-4o-mini", promptTokens: 1000, completionTokens: 1000 }) - (0.00015 + 0.0006)) < 1e-9);
});

test("flags context bloat when a huge prompt feeds a tiny completion", () => {
  const r = buildReport([rec({ promptTokens: 4000, completionTokens: 10 })], 7 * DAY, NOW);
  const bloat = r.waste.find((w) => w.kind === "context_bloat");
  assert.ok(bloat, "expected a context_bloat finding");
  assert.equal(bloat!.tokens, 4000 - 8 * 10); // excess prompt over the allowed ratio
});

test("flags model overkill: a trivial answer on a big model", () => {
  const r = buildReport([rec({ model: "gpt-4o", promptTokens: 500, completionTokens: 20 })], 7 * DAY, NOW);
  const ok = r.waste.find((w) => w.kind === "model_overkill");
  assert.ok(ok, "expected a model_overkill finding");
  assert.ok(ok!.usd > 0); // cheaper on a small model
});

test("does not flag overkill when a small model already does the trivial call", () => {
  const r = buildReport([rec({ model: "gpt-4o-mini", promptTokens: 500, completionTokens: 20 })], 7 * DAY, NOW);
  assert.equal(r.waste.find((w) => w.kind === "model_overkill"), undefined);
});

test("flags duplicates: identical model+category+promptTokens repeated", () => {
  const dup = { model: "gpt-4o-mini", category: "agent", promptTokens: 200, completionTokens: 5 };
  const r = buildReport([rec(dup), rec(dup), rec(dup)], 7 * DAY, NOW);
  const d = r.waste.find((w) => w.kind === "duplicate");
  assert.ok(d, "expected a duplicate finding");
  assert.equal(d!.calls, 2); // first call legitimate, 2 reclaimable
  assert.equal(d!.tokens, 400); // 2 × 200 prompt tokens
});

test("renderReport shows categories and an empty-state line", () => {
  assert.match(renderReport(buildReport([], 7 * DAY, NOW), 7), /no usage recorded/);
  const out = renderReport(buildReport([rec({ category: "agent", promptTokens: 2000, completionTokens: 5 })], 7 * DAY, NOW), 7);
  assert.match(out, /Where tokens go/);
  assert.match(out, /agent/);
  assert.match(out, /Where it's wasted/);
});
