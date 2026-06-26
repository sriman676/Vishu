import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type DomainEvent, EventBus } from "../transport/events.js";
import type { UsageRecord } from "./log.js";
import { BudgetWatcher, budgetAlert } from "./budget.js";

test("budgetAlert: under budget, disabled, or already-alerted → no alert", () => {
  assert.equal(budgetAlert(5, 10, false), null); // under
  assert.equal(budgetAlert(20, 0, false), null); // disabled
  assert.equal(budgetAlert(20, 10, true), null); // already alerted this crossing
});

test("budgetAlert: over budget and not yet alerted → alert with overage", () => {
  const a = budgetAlert(15, 10, false);
  assert.ok(a);
  assert.equal(a!.overUsd, 5);
  assert.equal(a!.pct, 150);
});

const NOW = 1_700_000_000_000;
const ledger = (recs: UsageRecord[]): string => {
  const f = join(mkdtempSync(join(tmpdir(), "vishu-budget-")), "usage.jsonl");
  writeFileSync(f, recs.map((r) => JSON.stringify(r)).join("\n"));
  return f;
};
// ~$1.50 of gpt-4o spend per record (10k in @ $0.0025/1k + 10k out @ $0.01/1k = $0.125)… keep it simple:
const rec = (over: Partial<UsageRecord> = {}): UsageRecord => ({ ts: NOW, model: "gpt-4o", category: "agent", promptTokens: 100_000, completionTokens: 100_000, ...over });

test("BudgetWatcher: publishes one budget notification on crossing, not every check", () => {
  const file = ledger([rec(), rec()]); // 2 × ($0.25 in + $1.00 out) = $2.50 > $1 budget
  const bus = new EventBus();
  const seen: DomainEvent[] = [];
  bus.subscribeDomain("system", (e) => e.type === "notification" && seen.push(e));

  const w = new BudgetWatcher(file, 1, bus);
  w.check(NOW);
  w.check(NOW); // second check must NOT re-alert
  assert.equal(seen.length, 1);
  assert.equal((seen[0]!.payload as { kind: string }).kind, "budget");
});

test("BudgetWatcher: silent when spend is under budget", () => {
  const file = ledger([rec()]); // $1.25
  const bus = new EventBus();
  const seen: DomainEvent[] = [];
  bus.subscribeDomain("system", (e) => seen.push(e));
  new BudgetWatcher(file, 100, bus).check(NOW);
  assert.equal(seen.length, 0);
});
