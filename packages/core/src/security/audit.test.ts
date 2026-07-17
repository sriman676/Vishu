import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { AuditLog, defaultAuditFile, verifyAuditFile } from "./audit.js";

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

test("two AuditLog instances on one file keep an intact chain (no stale-cache fork)", () => {
  // The gate's log + the builtins' egress log are separate instances sharing the default file. Interleave
  // their writes; a cached lastHash would fork the chain. Re-reading the tail per record must keep it valid.
  const file = tmpFile();
  const gate = new AuditLog(file);
  const egress = new AuditLog(file);
  gate.record({ kind: "gate", tool: "a", verdict: "allow" });
  egress.record({ kind: "egress", tool: "web_fetch", host: "x.test", verdict: "warn" });
  gate.record({ kind: "gate", tool: "b", verdict: "deny" }); // stale-cache bug would break the link here
  egress.record({ kind: "egress", tool: "web_fetch", host: "y.test", verdict: "warn" });
  const v = verifyAuditFile(file);
  assert.equal(v.ok, true);
  assert.equal(v.entries, 4);
});

test("AuditLog.record never throws on an unwritable path (best-effort)", () => {
  // A path whose parent is a file, not a dir → mkdir/append fail; must be swallowed.
  const bad = join(tmpFile(), "nested", "decisions.jsonl");
  assert.doesNotThrow(() => new AuditLog(bad).record({ kind: "gate", tool: "x", verdict: "allow" }));
});

test("verifyAuditFile accepts an intact chain, across instances, and an absent file", () => {
  const file = tmpFile();
  assert.deepEqual(verifyAuditFile(file), { ok: true, entries: 0 }); // no log yet
  new AuditLog(file).record({ kind: "gate", tool: "a", verdict: "allow" });
  new AuditLog(file).record({ kind: "gate", tool: "b", action: "send", verdict: "deny" }); // new instance re-seeds
  const v = verifyAuditFile(file);
  assert.equal(v.ok, true);
  assert.equal(v.entries, 2);
});

test("verifyAuditFile catches an edited line and a deleted line", () => {
  const file = tmpFile();
  const log = new AuditLog(file);
  log.record({ kind: "gate", tool: "a", verdict: "allow" });
  log.record({ kind: "gate", tool: "b", verdict: "allow" });
  log.record({ kind: "gate", tool: "c", verdict: "allow" });

  const lines = readFileSync(file, "utf8").trim().split("\n");
  // Tamper: flip the verdict on line 2 without touching its hash → content altered.
  const edited = [...lines];
  edited[1] = edited[1].replace('"verdict":"allow"', '"verdict":"deny"');
  writeFileSync(file, `${edited.join("\n")}\n`);
  const bad = verifyAuditFile(file);
  assert.equal(bad.ok, false);
  assert.equal(bad.brokenAt, 2);

  // Delete the middle line → the next line's prev no longer links.
  writeFileSync(file, `${[lines[0], lines[2]].join("\n")}\n`);
  const gap = verifyAuditFile(file);
  assert.equal(gap.ok, false);
  assert.equal(gap.brokenAt, 2);
});

test("defaultAuditFile honours VISHU_AUDIT_FILE and differs from the home default", () => {
  const override = defaultAuditFile({ VISHU_AUDIT_FILE: join(tmpdir(), "x.jsonl") } as NodeJS.ProcessEnv);
  assert.equal(override, resolve(join(tmpdir(), "x.jsonl")));
  assert.notEqual(override, defaultAuditFile({} as NodeJS.ProcessEnv));
});
