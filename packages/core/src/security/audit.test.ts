import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { AuditLog, defaultAuditFile } from "./audit.js";

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), "vishu-audit-")), "decisions.jsonl");
}

test("AuditLog appends one JSON line per record with a timestamp", () => {
  const file = tmpFile();
  const log = new AuditLog(file);
  log.record({ kind: "gate", tool: "send_email", action: "send", verdict: "deny", reason: "user denied" });
  log.record({ kind: "egress", tool: "web_fetch", host: "evil.test", verdict: "warn", reason: "not on allowlist" });

  const lines = readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.tool, "send_email");
  assert.equal(first.verdict, "deny");
  assert.match(first.ts, /^\d{4}-\d{2}-\d{2}T/); // ISO timestamp present
  assert.equal(JSON.parse(lines[1]).host, "evil.test");
});

test("AuditLog is append-only across instances (durable across runs)", () => {
  const file = tmpFile();
  new AuditLog(file).record({ kind: "gate", tool: "a", verdict: "allow" });
  new AuditLog(file).record({ kind: "gate", tool: "b", verdict: "allow" });
  assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 2);
});

test("AuditLog.record never throws on an unwritable path (best-effort)", () => {
  // A path whose parent is a file, not a dir → mkdir/append fail; must be swallowed.
  const bad = join(tmpFile(), "nested", "decisions.jsonl");
  assert.doesNotThrow(() => new AuditLog(bad).record({ kind: "gate", tool: "x", verdict: "allow" }));
});

test("defaultAuditFile honours VISHU_AUDIT_FILE and differs from the home default", () => {
  const override = defaultAuditFile({ VISHU_AUDIT_FILE: join(tmpdir(), "x.jsonl") } as NodeJS.ProcessEnv);
  assert.equal(override, resolve(join(tmpdir(), "x.jsonl")));
  assert.notEqual(override, defaultAuditFile({} as NodeJS.ProcessEnv));
});
