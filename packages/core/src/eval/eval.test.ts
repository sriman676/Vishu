import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EvalHistory } from "./history.js";
import { runEval } from "./runner.js";
import { BUILTIN_SUITE } from "./suite.js";
import type { EvalReport, Runner } from "./types.js";

// A scripted runner: answers keyed by prompt substring; unknown prompts return "" (graded as a fail).
const scripted = (answers: Record<string, string>): Runner => async (prompt) => {
  const key = Object.keys(answers).find((k) => prompt.includes(k));
  return key ? answers[key]! : "";
};

test("runEval grades answers and aggregates pass-rate + mean score", async () => {
  const runner = scripted({ "17 + 25": "42", water: "H2O", "{\"ok\":true}": '{"ok":true}', "240 km": "wrong" });
  const report = await runEval(BUILTIN_SUITE, runner, { runnerName: "test" });
  assert.equal(report.results.length, 4);
  assert.equal(report.passRate, 0.75); // 3 of 4 right (multistep is wrong)
  assert.equal(report.meanScore, 0.75);
  assert.equal(report.results.find((r) => r.id === "multistep")?.passed, false);
});

test("runEval: a throwing runner scores 0 with the error as detail, never crashes", async () => {
  const boom: Runner = async () => {
    throw new Error("provider down");
  };
  const report = await runEval([BUILTIN_SUITE[0]!], boom);
  assert.equal(report.passRate, 0);
  assert.equal(report.results[0]?.detail, "provider down");
});

test("EvalHistory records runs and reports the trend vs the previous run", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-eval-"));
  try {
    const history = new EvalHistory(join(dir, "history.jsonl"));
    const mk = (meanScore: number): EvalReport => ({ ts: Date.now(), runner: "effort", passRate: meanScore, meanScore, results: [] });
    history.record(mk(0.5));
    history.record(mk(0.75));
    const t = history.trend("effort");
    assert.equal(t.runs, 2);
    assert.equal(t.latest, 0.75);
    assert.equal(t.previous, 0.5);
    assert.equal(t.delta, 0.25);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
