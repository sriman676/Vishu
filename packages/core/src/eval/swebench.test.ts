import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePrediction, normalizeRows, predictionsToJsonl, toPrediction, type SweInstance } from "./swebench.js";

const INST: SweInstance = { instance_id: "django__django-1", repo: "django/django", base_commit: "abc123", problem_statement: "fix the bug" };

test("normalizeRows keeps only the four harness fields and stringifies", () => {
  const out = normalizeRows([{ instance_id: "x", repo: "a/b", base_commit: "c", problem_statement: "p", extra: 99 }]);
  assert.deepEqual(out, [{ instance_id: "x", repo: "a/b", base_commit: "c", problem_statement: "p" }]);
});

test("predictionsToJsonl emits one object per line in the harness format", () => {
  const jsonl = predictionsToJsonl([toPrediction(INST, "gpt-x", "diff --git a b")]);
  assert.equal(jsonl, '{"instance_id":"django__django-1","model_name_or_path":"gpt-x","model_patch":"diff --git a b"}\n');
  assert.equal(predictionsToJsonl([]), "");
});

test("generatePrediction captures the post-agent git diff as the patch", async () => {
  const calls: string[][] = [];
  const git = (args: string[]) => {
    calls.push(args);
    return args[0] === "diff" ? "THE PATCH" : "";
  };
  const pred = await generatePrediction(INST, "m", { cacheDir: "/tmp/x", git, runAgent: async () => {} });
  assert.equal(pred.model_patch, "THE PATCH");
  assert.equal(pred.instance_id, INST.instance_id);
  assert.ok(calls.some((c) => c[0] === "checkout")); // repo was checked out at base commit
});

test("an agent that throws still yields a prediction (empty patch scores 0, never aborts the suite)", async () => {
  const git = (args: string[]) => (args[0] === "diff" ? "" : "");
  const pred = await generatePrediction(INST, "m", {
    cacheDir: "/tmp/x",
    git,
    runAgent: async () => {
      throw new Error("model exploded");
    },
  });
  assert.equal(pred.model_patch, "");
});
