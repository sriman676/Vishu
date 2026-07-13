import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionClass } from "../security/actions.js";
import { ApprovalGate } from "./approvals.js";

const call = (name: string, args: Record<string, unknown> = {}) => ({ id: "1", name, arguments: args });
const actionOf = (m: Record<string, ActionClass>) => (n: string) => m[n] ?? "write";

test("send/spend/delete/change_setting ALWAYS ask — even under automatic autonomy", async () => {
  const asked: string[] = [];
  const gate = new ApprovalGate("automatic", async (r) => (asked.push(r.tool), false), {
    actionOf: actionOf({ outreach_send: "send", pay_invoice: "spend", delete_note: "delete", set_mode: "change_setting" }),
    isPaused: () => false,
  });
  for (const t of ["outreach_send", "pay_invoice", "delete_note", "set_mode"]) {
    assert.equal((await gate.decide(call(t))).allowed, false, `${t} must be blocked when the human says no`);
  }
  assert.deepEqual(asked, ["outreach_send", "pay_invoice", "delete_note", "set_mode"]);
});

test("decide() attaches a PAUL escalation status: done on allow, blocked when paused, needs_context on deny", async () => {
  const allowed = new ApprovalGate("automatic", async () => true, { actionOf: () => "read", isPaused: () => false });
  assert.equal((await allowed.decide(call("read_file"))).status, "done");

  const paused = new ApprovalGate("automatic", async () => false, { actionOf: () => "write", isPaused: () => true });
  assert.equal((await paused.decide(call("write_file"))).status, "blocked");

  const denied = new ApprovalGate("automatic", async () => false, { actionOf: () => "send", isPaused: () => false });
  assert.equal((await denied.decide(call("outreach_send"))).status, "needs_context");
});

test("a send tool is asked EVERY time — ask_once never remembers a dangerous class", async () => {
  let asks = 0;
  const gate = new ApprovalGate("ask_once", async () => (asks++, true), {
    actionOf: actionOf({ outreach_send: "send" }),
    isPaused: () => false,
  });
  await gate.decide(call("outreach_send"));
  await gate.decide(call("outreach_send"));
  assert.equal(asks, 2); // no memoization for send/spend/delete/change_setting
});

test("ask_once remembers persist across gate instances / restarts (UPGRADES §1)", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "vishu-remember-")), "approvals.json");
  const risky = () => call("run_shell", { command: "git push" }); // klass=risky → reaches the ask_once path
  const gate = (onAsk: () => boolean, count: { n: number }) =>
    new ApprovalGate("ask_once", async () => (count.n++, onAsk()), { actionOf: () => "write", isPaused: () => false, rememberFile: file });

  const a = { n: 0 };
  const g1 = gate(() => true, a);
  assert.equal((await g1.decide(risky())).allowed, true);
  assert.equal((await g1.decide(risky())).allowed, true); // remembered in-memory
  assert.equal(a.n, 1, "asked once, then remembered");

  const b = { n: 0 };
  const g2 = gate(() => false, b); // fresh instance = a "restart"; would deny if it re-asked
  assert.equal((await g2.decide(risky())).allowed, true, "loaded the persisted yes from disk");
  assert.equal(b.n, 0, "never asked — the remember survived the restart");
});

test("send-class carries a typed-confirm phrase; spend too, other classes stay y/N (UPGRADES §1)", async () => {
  const seen: Record<string, string | undefined> = {};
  const gate = new ApprovalGate("automatic", async (r) => (seen[r.action] = r.confirm, true), {
    actionOf: actionOf({ outreach_send: "send", pay: "spend", del: "delete" }),
    isPaused: () => false,
  });
  await gate.decide(call("outreach_send"));
  await gate.decide(call("pay"));
  await gate.decide(call("del"));
  assert.equal(seen.send, "SEND");
  assert.equal(seen.spend, "SPEND");
  assert.equal(seen.delete, undefined); // delete is still a plain y/N confirm
});

test("daily send cap: denies once the day's quota is spent, without prompting (UPGRADES §1 / F7)", async () => {
  let asks = 0;
  const gate = new ApprovalGate("automatic", async () => (asks++, true), {
    actionOf: actionOf({ outreach_send: "send" }),
    isPaused: () => false,
    sendCap: 2,
  });
  assert.equal((await gate.decide(call("outreach_send"))).allowed, true);
  assert.equal((await gate.decide(call("outreach_send"))).allowed, true);
  const third = await gate.decide(call("outreach_send"));
  assert.equal(third.allowed, false);
  assert.match(third.reason ?? "", /daily send cap/);
  assert.equal(asks, 2, "the capped call is denied before the human is even prompted");
});

test("reads still auto-allow under automatic", async () => {
  const gate = new ApprovalGate("automatic", async () => false, {
    actionOf: actionOf({ read_file: "read" }),
    isPaused: () => false,
  });
  assert.equal((await gate.decide(call("read_file"))).allowed, true);
});

test("global pause denies every side-effecting action, allows reads, and lets resume through", async () => {
  const gate = new ApprovalGate("automatic", async () => true, {
    actionOf: actionOf({ write_file: "write", read_file: "read", jarvis_resume: "change_setting" }),
    isPaused: () => true,
  });
  assert.equal((await gate.decide(call("write_file"))).allowed, false, "writes blocked while paused");
  assert.equal((await gate.decide(call("read_file"))).allowed, true, "reads still allowed while paused");
  // jarvis_resume is pause-exempt but still confirmed (change_setting) — here the human says yes.
  assert.equal((await gate.decide(call("jarvis_resume"))).allowed, true, "resume can run while paused");
});
