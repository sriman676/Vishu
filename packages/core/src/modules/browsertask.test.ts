import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type BrowserTask, expandTask, TaskLibrary } from "./browsertask.js";

const recipe: BrowserTask = {
  name: "t",
  params: ["url", "who"],
  steps: [
    { tool: "browser_open", args: { url: "{{url}}" } },
    { tool: "browser_type", args: { text: "Name", value: "{{who}}" } },
  ],
};

test("expandTask substitutes every placeholder and preserves order", () => {
  const plan = expandTask(recipe, { url: "https://x.io", who: "Sam" });
  assert.deepEqual(plan, [
    { tool: "browser_open", note: undefined, args: { url: "https://x.io" } },
    { tool: "browser_type", note: undefined, args: { text: "Name", value: "Sam" } },
  ]);
});

test("expandTask fails fast on a missing param (never hands back a half-filled plan)", () => {
  assert.throws(() => expandTask(recipe, { url: "https://x.io" }), /missing params: who/);
});

test("expandTask rejects a step that references an undeclared placeholder", () => {
  const bad: BrowserTask = { name: "b", params: [], steps: [{ tool: "browser_open", args: { url: "{{ghost}}" } }] };
  assert.throws(() => expandTask(bad, {}), /unknown placeholder: \{\{ghost\}\}/);
});

test("TaskLibrary seeds job_apply on first use, and save/get/list round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-tasklib-"));
  try {
    const lib = new TaskLibrary(join(dir, "tasks.json"));
    assert.ok(lib.get("job_apply"), "seeded on first use");
    assert.ok(lib.list().length >= 1);

    lib.save(recipe);
    assert.deepEqual(lib.get("t")?.params, ["url", "who"]);

    // persisted: a fresh instance over the same file sees the saved recipe (no re-seed clobber)
    const reopened = new TaskLibrary(join(dir, "tasks.json"));
    assert.ok(reopened.get("t") && reopened.get("job_apply"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
