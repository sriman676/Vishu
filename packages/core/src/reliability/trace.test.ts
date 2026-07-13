import assert from "node:assert/strict";
import { test } from "node:test";
import { type SpanRecord, spanReport, Tracer } from "./trace.js";

test("Tracer times a span and hands it to the sink; a throw still records ok=false", async () => {
  const spans: SpanRecord[] = [];
  const tr = new Tracer({ record: (s) => spans.push(s) });
  const out = await tr.span("router.chat", async () => 42, "agent");
  assert.equal(out, 42);
  await assert.rejects(tr.span("tool:boom", async () => { throw new Error("x"); }));
  assert.equal(spans.length, 2);
  assert.equal(spans[0]!.name, "router.chat");
  assert.equal(spans[0]!.ok, true);
  assert.equal(spans[1]!.ok, false);
  assert.ok(spans[0]!.ms >= 0);
});

test("Tracer with no sink is a pass-through (still runs fn)", async () => {
  assert.equal(await new Tracer().span("x", async () => "done"), "done");
});

test("spanReport aggregates by name with p50/p95/max and error counts", () => {
  const now = 1_000_000;
  const mk = (name: string, ms: number, ok = true): SpanRecord => ({ ts: now, name, ms, ok });
  const spans = [mk("tool:a", 10), mk("tool:a", 20), mk("tool:a", 100), mk("tool:a", 5, false), mk("router.chat", 50)];
  const rep = spanReport(spans, 1_000, now);
  const a = rep.find((s) => s.name === "tool:a")!;
  assert.equal(a.calls, 4);
  assert.equal(a.errors, 1);
  assert.equal(a.maxMs, 100);
  assert.equal(a.p50 >= 10 && a.p50 <= 100, true);
  assert.equal(rep[0]!.name, "tool:a"); // sorted by totalMs desc
});
