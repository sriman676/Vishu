import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Terminal } from "./terminal.js";
import { autoSandbox, dockerAvailable, dockerSandbox, noopSandbox } from "./sandbox.js";

test("persistent terminal: cwd survives across commands and exit codes are captured", async () => {
  const root = mkdtempSync(join(tmpdir(), "vishu-term-"));
  const term = new Terminal(root);
  try {
    const a = await term.exec(process.platform === "win32" ? "Set-Location ..; (Get-Location).Path" : "cd ..; pwd");
    assert.equal(a.exitCode, 0);
    // Second command runs in the cwd the first one moved to → proves session persistence.
    const b = await term.exec(process.platform === "win32" ? "(Get-Location).Path" : "pwd");
    assert.equal(b.stdout.trim(), a.stdout.trim());
    assert.equal(b.exitCode, 0);
  } finally {
    term.close();
  }
});

test("sandbox wrap: noop is identity, docker confines into /work", () => {
  assert.equal(noopSandbox.wrap("ls", "/x"), "ls");
  const wrapped = dockerSandbox().wrap("ls", "/x");
  assert.match(wrapped, /docker run --rm -i --network none -v "\/x:\/work" -w \/work alpine:3 sh -c 'ls'/);
});

test("autoSandbox: VISHU_SANDBOX=policy forces the jail sandbox; otherwise tracks Docker availability", () => {
  const prev = process.env.VISHU_SANDBOX;
  process.env.VISHU_SANDBOX = "policy";
  assert.equal(autoSandbox().name, "noop"); // forced off regardless of Docker
  delete process.env.VISHU_SANDBOX;
  const expected = dockerAvailable() ? "docker" : "noop"; // container when the daemon answers, else jail
  assert.equal(autoSandbox().name.startsWith(expected), true);
  if (prev !== undefined) process.env.VISHU_SANDBOX = prev;
  else delete process.env.VISHU_SANDBOX;
});
