import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WorkflowStore } from "../automation/workflows.js";
import { DigitalTwin } from "./twin.js";

test("twin.anticipate: nudges a task at its learned peak hour, once per day", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-twin-ant-"));
  try {
    const twin = new DigitalTwin(join(dir, "twin.json"));
    const at8 = (day: number) => new Date(2026, 0, day, 8, 0, 0).getTime(); // 8am local
    twin.record("morning brief", at8(1));
    twin.record("morning brief", at8(2));
    twin.record("morning brief", at8(3)); // count 3, peak hour = 8

    const noon = new Date(2026, 0, 4, 12, 0, 0).getTime();
    assert.deepEqual(twin.anticipate(noon, 3), []); // wrong hour → nothing anticipated

    const morning = new Date(2026, 0, 4, 8, 30, 0).getTime();
    assert.deepEqual(twin.anticipate(morning, 3), ["morning brief"]); // learned peak hour → anticipated
    assert.deepEqual(twin.anticipate(morning, 3), []); // same day → deduped

    const nextMorning = new Date(2026, 0, 5, 8, 15, 0).getTime();
    assert.deepEqual(twin.anticipate(nextMorning, 3), ["morning brief"]); // new day → nudges again

    // below the count threshold is never anticipated, even at its learned hour
    twin.record("rare thing", at8(6)); // count 1
    assert.ok(!twin.anticipate(at8(7), 3).includes("rare thing"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("twin: a repeated task is suggested, then accepted into a saved workflow", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-twin-"));
  try {
    const twin = new DigitalTwin(join(dir, "twin.json"));
    const workflows = new WorkflowStore(join(dir, "workflows"));

    // case/whitespace variants count as the same task; below threshold → no suggestion yet
    twin.record("Deploy the   staging build");
    twin.record("deploy the staging build");
    assert.deepEqual(twin.suggestions(3), []);

    assert.equal(twin.record("DEPLOY THE STAGING BUILD"), 3); // third occurrence
    assert.deepEqual(twin.suggestions(3), ["Deploy the staging build"]); // first-seen sample

    const wf = twin.accept("Deploy the staging build", workflows);
    assert.deepEqual(wf.steps, ["Deploy the staging build"]);
    assert.ok(workflows.get("Deploy the staging build"), "accepted task is saved as a workflow");
    assert.deepEqual(twin.suggestions(3), []); // accepted → no longer suggested
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("twin: counts persist across reloads (atomic JSON store)", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-twin-"));
  const file = join(dir, "twin.json");
  try {
    new DigitalTwin(file).record("write the weekly report");
    new DigitalTwin(file).record("write the weekly report");
    const twin = new DigitalTwin(file);
    assert.equal(twin.record("write the weekly report"), 3); // survived two reloads
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
