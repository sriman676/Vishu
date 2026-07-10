import assert from "node:assert/strict";
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
