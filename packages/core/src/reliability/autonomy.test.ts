import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionClass } from "../security/actions.js";
import { ApprovalGate } from "./approvals.js";
import { DecisionStore } from "./autonomy.js";

const call = (name: string, args: Record<string, unknown> = {}) => ({ id: "1", name, arguments: args });
const tmpStore = () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-autonomy-"));
  return new DecisionStore(join(dir, "decisions.jsonl"), join(dir, "grants.json"), 3);
};

test("after N clean approvals a reversible signature is suggested exactly once, then grant auto-approves", async () => {
  const store = tmpStore();
  const suggested: string[] = [];
  let asks = 0;
  const gate = new ApprovalGate("ask_every_time", async () => (asks++, true), {
    actionOf: () => "write",
    isPaused: () => false,
    decisions: store,
    suggest: (a, s) => suggested.push(`${a} ${s}`),
  });
  const risky = () => call("run_shell", { command: "git push" }); // klass risky → reaches the ask path
  for (let i = 0; i < 3; i++) assert.equal((await gate.decide(risky())).allowed, true);
  assert.equal(asks, 3, "asked every time (not yet granted)");
  assert.deepEqual(suggested, ["write run_shell"], "suggested once, on the 3rd clean approval");

  // Human grants it → the gate auto-approves BEFORE asking.
  assert.deepEqual(store.grant("write", "run_shell"), { granted: true });
  const before = asks;
  const d = await gate.decide(risky());
  assert.equal(d.allowed, true);
  assert.equal(d.reason, "auto-approved (granted)");
  assert.equal(asks, before, "granted signature is not asked");
});

test("a deny breaks the streak — no suggestion", async () => {
  const store = tmpStore();
  const suggested: string[] = [];
  let approve = true;
  const gate = new ApprovalGate("ask_every_time", async () => approve, {
    actionOf: () => "write",
    isPaused: () => false,
    decisions: store,
    suggest: (a, s) => suggested.push(`${a} ${s}`),
  });
  const risky = () => call("run_shell", { command: "git push" });
  await gate.decide(risky());
  approve = false;
  await gate.decide(risky()); // deny breaks the run
  approve = true;
  await gate.decide(risky());
  await gate.decide(risky());
  assert.deepEqual(suggested, [], "a broken streak never reaches the threshold");
});

test("floor classes are never suggested and never grantable", async () => {
  const store = tmpStore();
  const suggested: string[] = [];
  const gate = new ApprovalGate("automatic", async () => true, {
    actionOf: (n: string): ActionClass => (n === "outreach_send" ? "send" : "write"),
    isPaused: () => false,
    decisions: store,
    suggest: (a, s) => suggested.push(`${a} ${s}`),
  });
  for (let i = 0; i < 5; i++) await gate.decide(call("outreach_send"));
  assert.deepEqual(suggested, [], "send is a hard-floor class — never suggested");
  assert.deepEqual(store.grant("send", "outreach_send"), { granted: false, reason: "send is always-ask" });
});

test("N clean approvals form a learned auto-allow tier without any manual grant", async () => {
  const store = tmpStore();
  let asks = 0;
  const gate = new ApprovalGate("ask_every_time", async () => (asks++, true), {
    actionOf: () => "write",
    isPaused: () => false,
    decisions: store,
  });
  const risky = () => call("run_shell", { command: "git push" }); // klass risky → reaches the ask path
  for (let i = 0; i < 3; i++) await gate.decide(risky());
  assert.equal(asks, 3, "asked the first three times");
  const d = await gate.decide(risky());
  assert.equal(d.allowed, true);
  assert.equal(d.reason, "auto-approved (learned)");
  assert.equal(asks, 3, "a learned signature is not asked again");
  assert.deepEqual(store.learnedList(), [{ actionClass: "write", signature: "run_shell" }]);
});

test("floor classes never form a learned tier — send stays always-ask after any number of yeses", async () => {
  const store = tmpStore();
  let asks = 0;
  const gate = new ApprovalGate("automatic", async () => (asks++, true), {
    actionOf: (): ActionClass => "send",
    isPaused: () => false,
    decisions: store,
  });
  const c = () => call("outreach_send");
  for (let i = 0; i < 5; i++) assert.equal((await gate.decide(c())).allowed, true);
  assert.equal(asks, 5, "every send is asked, even after 5 clean approvals");
  assert.equal(store.isLearned("send", "outreach_send"), false);
  assert.deepEqual(store.learnedList(), []);
});

test("revoke/unlearn breaks a learned tier — it must be re-earned", () => {
  const store = tmpStore();
  for (let i = 0; i < 3; i++) store.record({ ts: i, actionClass: "write", signature: "x", allowed: true });
  assert.equal(store.isLearned("write", "x"), true);
  store.unlearn("write", "x");
  assert.equal(store.isLearned("write", "x"), false);
});

test("decision log lists recent verdicts newest-first", () => {
  const store = tmpStore();
  store.record({ ts: 1, actionClass: "write", signature: "a", allowed: true });
  store.record({ ts: 2, actionClass: "write", signature: "b", allowed: false });
  const list = store.list();
  assert.equal(list[0].signature, "b");
  assert.equal(list[1].signature, "a");
});
