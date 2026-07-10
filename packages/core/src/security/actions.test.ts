import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyTool, NEVER_WITHOUT_ASKING } from "./actions.js";

test("classifyTool maps dangerous verbs to gated classes", () => {
  assert.equal(classifyTool("outreach_send"), "send");
  assert.equal(classifyTool("email_draft_and_send"), "send");
  assert.equal(classifyTool("wallet_transfer"), "spend");
  assert.equal(classifyTool("delete_note"), "delete");
  assert.equal(classifyTool("set_autonomy"), "change_setting");
  assert.equal(classifyTool("read_file"), "read");
  assert.equal(classifyTool("list_dir"), "read");
});

test("classifyTool: unknown tool defaults to write (never silently 'read')", () => {
  assert.equal(classifyTool("zzq_frobnicate_9000"), "write");
});

test("the four dangerous classes are exactly the always-ask set", () => {
  for (const a of ["send", "spend", "delete", "change_setting"] as const) {
    assert.ok(NEVER_WITHOUT_ASKING.has(a), `${a} must always ask`);
  }
  assert.ok(!NEVER_WITHOUT_ASKING.has("read"));
  assert.ok(!NEVER_WITHOUT_ASKING.has("write"));
});
