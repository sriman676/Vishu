import assert from "node:assert/strict";
import { test } from "node:test";
import { triggerAllowed } from "./trigger.js";

test("triggerAllowed is fail-closed and respects the allowlist", () => {
  assert.equal(triggerAllowed("boss@acme.com", {}), false, "unconfigured → refuse");
  assert.equal(triggerAllowed("boss@acme.com", { VISHU_TRIGGER_ALLOW: "" }), false, "empty → refuse");
  assert.equal(triggerAllowed("boss@acme.com", { VISHU_TRIGGER_ALLOW: "a@b.com" }), false, "not on list → refuse");
  assert.equal(triggerAllowed("boss@acme.com", { VISHU_TRIGGER_ALLOW: "BOSS@ACME.COM" }), true, "exact match, case-insensitive");
  assert.equal(triggerAllowed(" boss@acme.com ", { VISHU_TRIGGER_ALLOW: "x, boss@acme.com" }), true, "trims + list");
  assert.equal(triggerAllowed("anyone", { VISHU_TRIGGER_ALLOW: "*" }), true, "wildcard allows any");
});
