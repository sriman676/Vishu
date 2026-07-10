import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertBoot, selfCheck } from "./selfcheck.js";

function tmp(): string {
  return join(mkdtempSync(join(tmpdir(), "vishu-selfcheck-")), "f");
}

test("selfCheck passes when gate is wired and paths are writable", () => {
  const checks = selfCheck({ gateWired: true, auditFile: tmp(), pausePath: tmp() });
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks));
  assert.doesNotThrow(() => assertBoot(checks, () => {}));
});

test("assertBoot throws when a critical check fails (ungated boot)", () => {
  const checks = selfCheck({ gateWired: false, auditFile: tmp(), pausePath: tmp() });
  assert.throws(() => assertBoot(checks, () => {}), /gate wired/);
});

test("egress allowlist is always loaded (non-empty defaults)", () => {
  const c = selfCheck({ gateWired: true, auditFile: tmp(), pausePath: tmp() }).find((x) => x.name === "egress allowlist loaded")!;
  assert.ok(c.ok);
});
