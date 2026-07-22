import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { makePolicy } from "../security/policy.js";
import { registerBuiltins } from "./builtins.js";
import { ToolRegistry } from "./registry.js";
import { Terminal } from "./terminal.js";
import type { ToolContext } from "./types.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "vishu-eg-"));
  const reg = registerBuiltins(new ToolRegistry());
  const ctx: ToolContext = { policy: makePolicy("full", dir), terminal: new Terminal(dir) };
  return { dir, reg, ctx };
}

test("edit_file replaces a unique substring", async () => {
  const { dir, reg, ctx } = setup();
  writeFileSync(join(dir, "a.txt"), "hello world");
  await reg.get("edit_file").run({ path: "a.txt", old: "world", new: "vishu" }, ctx);
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "hello vishu");
});

test("edit_file rejects a missing substring", async () => {
  const { dir, reg, ctx } = setup();
  writeFileSync(join(dir, "a.txt"), "hello");
  await assert.rejects(() => reg.get("edit_file").run({ path: "a.txt", old: "nope", new: "x" }, ctx), /not found/);
});

test("edit_file rejects an ambiguous match unless replaceAll", async () => {
  const { dir, reg, ctx } = setup();
  writeFileSync(join(dir, "a.txt"), "x x x");
  await assert.rejects(() => reg.get("edit_file").run({ path: "a.txt", old: "x", new: "y" }, ctx), /appears 3/);
  await reg.get("edit_file").run({ path: "a.txt", old: "x", new: "y", replaceAll: true }, ctx);
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "y y y");
});

test("grep finds content by regex and reports no matches otherwise", async () => {
  const { dir, reg, ctx } = setup();
  writeFileSync(join(dir, "a.ts"), "const foo = 1;\nconst bar = 2;");
  const hit = await reg.get("grep").run({ pattern: "const \\w+" }, ctx);
  assert.match(hit, /a\.ts:1:.*foo/);
  const miss = await reg.get("grep").run({ pattern: "zzzznever" }, ctx);
  assert.equal(miss, "[grep] no matches");
});

test("grep name filter restricts files searched", async () => {
  const { dir, reg, ctx } = setup();
  writeFileSync(join(dir, "keep.ts"), "target");
  writeFileSync(join(dir, "skip.md"), "target");
  const out = await reg.get("grep").run({ pattern: "target", glob: ".ts" }, ctx);
  assert.match(out, /keep\.ts/);
  assert.doesNotMatch(out, /skip\.md/);
});
