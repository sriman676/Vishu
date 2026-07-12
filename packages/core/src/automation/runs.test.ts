import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resumeIncomplete, RunStore, runWorkflowDurable } from "./runs.js";
import type { StepRunner, Workflow } from "./workflows.js";

const store = () => new RunStore(mkdtempSync(join(tmpdir(), "vishu-runs-")));

test("runWorkflowDurable checkpoints and completes; outputs in order (§11e)", async () => {
  const s = store();
  const wf: Workflow = { name: "nightly", steps: ["a", "b", "c"] };
  const rec = await runWorkflowDurable(wf, async (x) => `out:${x}`, s, "r1");
  assert.equal(rec.status, "done");
  assert.deepEqual(rec.outputs, ["out:a", "out:b", "out:c"]);
  assert.equal(s.get("r1")!.status, "done");
});

test("a crash mid-run resumes at the first unfinished step — completed steps never re-run (§11e)", async () => {
  const s = store();
  const wf: Workflow = { name: "nightly", steps: ["a", "b", "c"] };
  const ran: string[] = [];
  let failOnB = true;
  const runner: StepRunner = async (step) => {
    if (step === "b" && failOnB) {
      failOnB = false; // the "crash": b fails once, succeeds on resume
      throw new Error("boom");
    }
    ran.push(step);
    return `out:${step}`;
  };

  await assert.rejects(runWorkflowDurable(wf, runner, s, "r1"), /boom/);
  assert.deepEqual(ran, ["a"], "only a ran before the crash");
  const failed = s.get("r1")!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.cursor, 1, "persisted at the failed step");

  const resumed = await resumeIncomplete(s, (n) => (n === "nightly" ? wf : undefined), runner);
  assert.deepEqual(resumed, ["r1"]);
  assert.deepEqual(ran, ["a", "b", "c"], "resumed from b; a was not re-run (no duplicate side effect)");
  assert.equal(s.get("r1")!.status, "done");
});
