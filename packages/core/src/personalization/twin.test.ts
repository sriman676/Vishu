import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WorkflowStore } from "../automation/workflows.js";
import { DigitalTwin } from "./twin.js";

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
