import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ApprovalGate } from "./approvals.js";
import { Budget, BudgetExceeded } from "./budget.js";
import { Checkpoints } from "./checkpoint.js";
import { selfVerify } from "./verify.js";

test("selfVerify catches a planted bug and auto-corrects within budget", async () => {
  let buggy = true;
  const validator = { name: "test", run: async () => ({ ok: !buggy, output: buggy ? "FAIL" : "PASS" }) };
  const result = await selfVerify(validator, async () => {
    buggy = false; // the "fix"
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
});

test("budget cap halts cleanly with BudgetExceeded", () => {
  const budget = new Budget(0.0001);
  assert.throws(() => budget.charge(100_000, 100_000), BudgetExceeded);
});

test("approval gate: automatic allows, ask_every_time interrupts only for risky shell", async () => {
  const auto = new ApprovalGate("automatic", async () => false);
  assert.equal((await auto.decide({ id: "1", name: "run_shell", arguments: { command: "rm file" } })).allowed, true);

  const asked: string[] = [];
  const gate = new ApprovalGate("ask_every_time", async (r) => {
    asked.push(r.tool);
    return false;
  });
  assert.equal((await gate.decide({ id: "1", name: "write_file", arguments: {} })).allowed, true); // safe → auto
  assert.equal((await gate.decide({ id: "2", name: "run_shell", arguments: { command: "git push" } })).allowed, false); // risky → asked+denied
  assert.deepEqual(asked, ["run_shell"]);
});

const hasGit = spawnSync("git", ["--version"]).status === 0;
test("checkpoints make a risky edit undoable", { skip: !hasGit }, () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-cp-"));
  const file = join(dir, "data.txt");
  const cp = new Checkpoints(dir);
  cp.init();
  writeFileSync(file, "v1");
  const good = cp.snapshot("v1");
  writeFileSync(file, "v2-broken");
  cp.snapshot("v2");
  cp.undoTo(good);
  assert.equal(readFileSync(file, "utf8"), "v1");
});
