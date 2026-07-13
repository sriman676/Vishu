import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ledgerReport, readLedger, turns } from "./ledger.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "vishu-ledger-"));
}

test("readLedger merges token + decision logs into one timestamped stream", () => {
  const dir = tmp();
  const usage = join(dir, "usage.jsonl");
  const decisions = join(dir, "decisions.jsonl");
  writeFileSync(usage, `${JSON.stringify({ ts: 30, model: "opus", category: "agent", promptTokens: 100, completionTokens: 10 })}\n`);
  writeFileSync(
    decisions,
    `${JSON.stringify({ ts: 10, actionClass: "send", signature: "x", allowed: false })}\n${JSON.stringify({ ts: 20, actionClass: "read", signature: "y", allowed: true })}\n`,
  );
  const events = readLedger(usage, decisions);
  assert.deepEqual(
    events.map((e) => [e.ts, e.kind]),
    [
      [10, "decision"],
      [20, "decision"],
      [30, "tokens"],
    ],
  );
  const tok = events[2];
  assert.equal(tok.kind === "tokens" && tok.usd > 0, true); // opus is priced → cost attributed
});

test("turns segment on the idle gap; report attributes cost + denials per turn", () => {
  const base = 1_000_000;
  const events = readLedgerFromInline([
    { ts: base, kind: "tokens", usd: 0.5, tokens: 100 },
    { ts: base + 5_000, kind: "decision", allowed: false }, // same turn (5s gap)
    { ts: base + 200_000, kind: "tokens", usd: 0.25, tokens: 50 }, // >60s later → new turn
  ]);
  const ts = turns(events);
  assert.equal(ts.length, 2);
  assert.equal(ts[0]!.calls, 1);
  assert.equal(ts[0]!.denied, 1);
  assert.equal(ts[1]!.calls, 1);

  const r = ledgerReport(events, 1_000_000_000, base + 300_000);
  assert.equal(r.turns.length, 2);
  assert.equal(Number(r.totalUsd.toFixed(2)), 0.75);
  assert.equal(r.totalDenied, 1);
});

// Tiny helper: build LedgerEvents without going through files.
type Inline = { ts: number; kind: "tokens"; usd: number; tokens: number } | { ts: number; kind: "decision"; allowed: boolean };
function readLedgerFromInline(items: Inline[]) {
  return items.map((i) =>
    i.kind === "tokens"
      ? ({ ts: i.ts, kind: "tokens", model: "opus", category: "agent", promptTokens: i.tokens, completionTokens: 0, usd: i.usd } as const)
      : ({ ts: i.ts, kind: "decision", actionClass: "send", signature: "x", allowed: i.allowed } as const),
  );
}
