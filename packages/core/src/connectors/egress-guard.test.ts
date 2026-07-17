import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AuditLog } from "../security/audit.js";
import { SecurityError } from "../security/policy.js";
import { guardSendEgress } from "./egress-guard.js";

function freshAudit(): { audit: AuditLog; entries: () => Array<Record<string, unknown>> } {
  const file = join(mkdtempSync(join(tmpdir(), "vishu-egress-")), "decisions.jsonl");
  return {
    audit: new AuditLog(file),
    entries: () => {
      try {
        return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
  };
}

const allow = new Set(["hooks.example.com"]);

test("guardSendEgress: allowlisted host → returns host + logs allow", () => {
  const { audit, entries } = freshAudit();
  const host = guardSendEgress("webhook:alerts", "https://hooks.example.com/x", audit, allow);
  assert.equal(host, "hooks.example.com");
  const log = entries();
  assert.equal(log.length, 1);
  assert.equal(log[0]!.verdict, "allow");
  assert.equal(log[0]!.host, "hooks.example.com");
});

test("guardSendEgress: non-allowlisted host → throws SecurityError + logs deny (fail-closed)", () => {
  const { audit, entries } = freshAudit();
  assert.throws(
    () => guardSendEgress("telegram", "https://evil.example.com/exfil", audit, allow),
    (e: unknown) => e instanceof SecurityError && /non-allowlisted host/.test((e as Error).message),
  );
  const log = entries();
  assert.equal(log.length, 1);
  assert.equal(log[0]!.verdict, "deny");
  assert.equal(log[0]!.host, "evil.example.com");
});

test("guardSendEgress: malformed URL → refused (no host)", () => {
  const { audit } = freshAudit();
  assert.throws(() => guardSendEgress("webhook:x", "not a url", audit, allow), SecurityError);
});
