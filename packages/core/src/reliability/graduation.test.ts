import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionClass } from "../security/actions.js";
import { ApprovalGate } from "./approvals.js";
import { Graduation, graduationFromEnv } from "./graduation.js";

const call = (name: string, args: Record<string, unknown> = {}) => ({ id: "1", name, arguments: args });
const actionOf = (m: Record<string, ActionClass>) => (n: string) => m[n] ?? "write";

test("N clean approvals promote an opted-in class from ask→auto (§11d)", async () => {
  let asks = 0;
  const grad = new Graduation({ optIn: ["change_setting"], threshold: 3 });
  const gate = new ApprovalGate("automatic", async () => (asks++, true), {
    actionOf: actionOf({ set_mode: "change_setting" }),
    isPaused: () => false,
    graduation: grad,
  });
  for (let i = 0; i < 3; i++) assert.equal((await gate.decide(call("set_mode"))).allowed, true);
  assert.equal(asks, 3, "first N still prompt");
  const auto = await gate.decide(call("set_mode"));
  assert.equal(auto.allowed, true);
  assert.equal(auto.reason, "graduated");
  assert.equal(asks, 3, "the (N+1)th call is auto-allowed — no prompt");
});

test("a denied action resets the ladder — a broken streak never promotes (§11d)", async () => {
  const grad = new Graduation({ optIn: ["change_setting"], threshold: 2 });
  const answers = [true, false, true]; // yes, NO (reset), yes → only 1 consecutive
  let i = 0;
  const gate = new ApprovalGate("automatic", async () => answers[i++], {
    actionOf: actionOf({ set_mode: "change_setting" }),
    isPaused: () => false,
    graduation: grad,
  });
  for (const _ of answers) await gate.decide(call("set_mode"));
  assert.equal(grad.isPromoted("change_setting", "set_mode"), false, "the deny broke the streak");
});

test("a paused action never advances the ladder (§11d)", async () => {
  const grad = new Graduation({ optIn: ["change_setting"], threshold: 1 }); // 1 clean yes would promote
  const gate = new ApprovalGate("automatic", async () => true, {
    actionOf: actionOf({ set_mode: "change_setting" }),
    isPaused: () => true,
    graduation: grad,
  });
  assert.equal((await gate.decide(call("set_mode"))).allowed, false, "denied while paused");
  assert.equal(grad.isPromoted("change_setting", "set_mode"), false, "a paused denial never counts toward promotion");
});

test("send/spend/delete never auto-promote without explicit opt-in (§11d)", async () => {
  const grad = new Graduation({ optIn: [], threshold: 1 }); // nothing opted in — the default
  let asks = 0;
  const gate = new ApprovalGate("automatic", async () => (asks++, true), {
    actionOf: actionOf({ outreach_send: "send", pay: "spend", del: "delete" }),
    isPaused: () => false,
    graduation: grad,
  });
  for (let i = 0; i < 5; i++) {
    await gate.decide(call("outreach_send"));
    await gate.decide(call("pay"));
    await gate.decide(call("del"));
  }
  assert.equal(asks, 15, "every send/spend/delete still prompted — none graduated");
  assert.equal(grad.isPromoted("send", "outreach_send"), false);
  assert.equal(grad.isPromoted("spend", "pay"), false);
  assert.equal(grad.isPromoted("delete", "del"), false);
});

test("send graduation still honors the daily cap (§11d + F7)", async () => {
  const grad = new Graduation({ optIn: ["send"], threshold: 1 });
  let asks = 0;
  const gate = new ApprovalGate("automatic", async () => (asks++, true), {
    actionOf: actionOf({ outreach_send: "send" }),
    isPaused: () => false,
    graduation: grad,
    sendCap: 2,
  });
  assert.equal((await gate.decide(call("outreach_send"))).allowed, true); // asked (streak→1, promoted)
  assert.equal((await gate.decide(call("outreach_send"))).allowed, true); // graduated, cap now spent
  const third = await gate.decide(call("outreach_send"));
  assert.equal(third.allowed, false, "cap wins even over a graduated send");
  assert.match(third.reason ?? "", /daily send cap/);
  assert.equal(asks, 1, "only the first prompted — the rest graduated (or capped)");
});

test("graduationFromEnv: unset → undefined; opt-in classes parsed, unknowns dropped (§11d)", () => {
  assert.equal(graduationFromEnv({}), undefined, "no VISHU_GRADUATE → nothing graduates");
  assert.equal(graduationFromEnv({ VISHU_GRADUATE: "  " }), undefined, "blank → undefined");
  assert.equal(graduationFromEnv({ VISHU_GRADUATE: "bogus,nope" }), undefined, "all-unknown → undefined");
  const g = graduationFromEnv({ VISHU_GRADUATE: "write, send, bogus", VISHU_GRADUATE_N: "2" })!;
  assert.ok(g, "valid classes → a Graduation");
  g.record("write", "run_shell", true);
  g.record("write", "run_shell", true);
  assert.equal(g.isPromoted("write", "run_shell"), true, "opted-in + threshold met");
  assert.equal(g.isPromoted("delete", "rm"), false, "a class not opted in never graduates");
});

test("the ladder survives restart via its persist file (§11d)", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "vishu-grad-")), "graduation.json");
  const g1 = new Graduation({ optIn: ["change_setting"], threshold: 2, file });
  g1.record("change_setting", "set_mode", true);
  g1.record("change_setting", "set_mode", true);
  const g2 = new Graduation({ optIn: ["change_setting"], threshold: 2, file });
  assert.equal(g2.isPromoted("change_setting", "set_mode"), true, "loaded the streak from disk");
});
