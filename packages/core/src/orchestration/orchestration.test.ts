import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EchoProvider, ScriptedProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import { makePolicy } from "../security/policy.js";
import { registerBuiltins } from "../tools/builtins.js";
import { ToolRegistry } from "../tools/registry.js";
import { ARCHETYPES, narrowRegistry, narrowTier } from "./archetypes.js";
import { council, mixtureOfAgents } from "./council.js";
import { Coordinator } from "./coordinator.js";
import { NoParentContextError, runSubagent } from "./subagent.js";

test("council: members answer, judge picks the winner", async () => {
  const memberA = { router: new Router([new ScriptedProvider([{ content: "answer A", finish: "stop" }])]), model: "m1" };
  const memberB = { router: new Router([new ScriptedProvider([{ content: "answer B", finish: "stop" }])]), model: "m2" };
  const judge = { router: new Router([new ScriptedProvider([{ content: "1", finish: "stop" }])]), model: "judge" };
  const res = await council([memberA, memberB], "what is best?", { judge });
  assert.equal(res.answers.length, 2);
  assert.equal(res.chosenIndex, 1);
  assert.equal(res.chosen, "answer B");
});

const member = (model: string, ...replies: string[]) => ({
  router: new Router([new ScriptedProvider(replies.map((content) => ({ content, finish: "stop" as const })))]),
  model,
});

test("MoA: layers of proposers feed an explicit aggregator's synthesis", async () => {
  const a = member("A", "a1", "a2"); // one reply per layer
  const b = member("B", "b1", "b2");
  const agg = member("Agg", "final");
  const res = await mixtureOfAgents([a, b], "q", { aggregator: agg, layers: 2 });
  assert.equal(res.final, "final");
  assert.deepEqual(res.layerOutputs, [["a1", "b1"], ["a2", "b2"]]);
});

test("MoA: defaults the aggregator to the first member", async () => {
  const a = member("A", "a1", "a2", "synth"); // layer0, layer1, then the aggregation call
  const b = member("B", "b1", "b2");
  const res = await mixtureOfAgents([a, b], "q", { layers: 2 });
  assert.equal(res.final, "synth");
  assert.deepEqual(res.layerOutputs, [["a1", "b1"], ["a2", "b2"]]);
});

test("MoA: degrades to a single Router (one proposer per layer)", async () => {
  const solo = member("S", "p1", "p2");
  const agg = member("Agg", "F");
  const res = await mixtureOfAgents([solo], "q", { aggregator: agg, layers: 2 });
  assert.equal(res.final, "F");
  assert.deepEqual(res.layerOutputs, [["p1"], ["p2"]]);
});

test("inherit-and-narrow: tier only drops, tools are parent ∩ archetype", () => {
  assert.equal(narrowTier("supervised", "full"), "supervised"); // can't widen above parent
  assert.equal(narrowTier("full", "readonly"), "readonly"); // can drop

  const parent = registerBuiltins(new ToolRegistry()); // read_file, write_file, list_dir, run_shell, web_*
  const child = narrowRegistry(parent, ARCHETYPES.critic!); // critic: read_file, list_dir, run_shell, memory_recall
  const names = child.schemas().map((s) => s.name).sort();
  assert.deepEqual(names, ["list_dir", "read_file", "run_shell"]); // memory_recall absent from parent → can't appear
});

test("subagent refuses to spawn without parent context (NoParentContext contract)", async () => {
  await assert.rejects(
    runSubagent({
      archetype: ARCHETYPES.coder!,
      task: "do x",
      parentContext: "   ",
      parentPolicy: makePolicy("full", mkdtempSync(join(tmpdir(), "vishu-repo-"))),
      parentRegistry: new ToolRegistry(),
      router: new Router([new EchoProvider()]),
      model: "mock",
      repoDir: mkdtempSync(join(tmpdir(), "vishu-repo-")),
    }),
    NoParentContextError,
  );
});

test("orchestrated request fans out, prunes a failed branch, returns one result", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "vishu-orch-"));
  // call 0: hypotheses; call 1: branch-a subagent turn; call 2: branch-b subagent turn.
  const router = new Router([
    new ScriptedProvider([
      { content: "approach-a\napproach-b", finish: "stop" },
      { content: "built it the A way", finish: "stop" },
      { content: "built it the B way", finish: "stop" },
    ]),
  ]);
  const coordinator = new Coordinator({
    router,
    model: "mock",
    parentPolicy: makePolicy("full", repoDir),
    parentRegistry: registerBuiltins(new ToolRegistry()),
    repoDir,
  });

  const result = await coordinator.run("build a thing", {
    // branch A fails validation, branch B passes — prune A, harvest B.
    validate: async (hypothesis) => ({ ok: hypothesis.includes("b"), output: `validated ${hypothesis}` }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.chosen, "approach-b");
  assert.equal(result.branches.length, 2);
  assert.equal(result.branches[0]?.ok, false); // A pruned
  assert.equal(result.learnings.length, 1); // one lesson backpropagated
  assert.match(result.final, /built it the B way/);
  assert.match(result.final, /Backpropagated learnings/); // pruned-branch lesson carried into the result
});

test("parallel mode: branches race, the winner is auto-merged and failed-branch lessons carry over", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "vishu-par-"));
  // call 0: hypotheses; calls 1+ each branch's turn — identical content so concurrent order can't matter.
  const router = new Router([
    new ScriptedProvider([
      { content: "approach-a\napproach-b", finish: "stop" },
      { content: "built", finish: "stop" },
      { content: "built", finish: "stop" },
    ]),
  ]);
  const coordinator = new Coordinator({
    router,
    model: "mock",
    parentPolicy: makePolicy("full", repoDir),
    parentRegistry: registerBuiltins(new ToolRegistry()),
    repoDir,
  });

  const result = await coordinator.run("build a thing", {
    parallel: true,
    concurrency: 2,
    // branch b passes and drops an artifact in its worktree; branch a fails.
    validate: async (hypothesis, wt) => {
      if (!hypothesis.includes("b")) return { ok: false, output: `validated ${hypothesis}` };
      writeFileSync(join(wt, "artifact.txt"), "winner");
      return { ok: true, output: `validated ${hypothesis}` };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.chosen, "approach-b"); // the one that passed
  assert.equal(result.branches.length, 2);
  assert.equal(result.merged, true); // parallel winner is now auto-merged (serial, post-race)
  assert.equal(readFileSync(join(repoDir, "artifact.txt"), "utf8"), "winner"); // its work landed in the repo
  assert.equal(result.learnings.length, 1); // the failed branch's lesson is still collected
  assert.match(result.final, /Cross-branch learnings/); // …and backpropagated into the result
});

test("harvest: the winning branch's work is merged back into the action repo", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "vishu-harvest-"));
  const outcome = await runSubagent({
    archetype: ARCHETYPES.coder!,
    task: "do the thing",
    parentContext: "ctx",
    parentPolicy: makePolicy("full", repoDir),
    parentRegistry: registerBuiltins(new ToolRegistry()),
    router: new Router([new EchoProvider()]),
    model: "mock",
    repoDir,
    harvest: true,
    // validation stands in for the subagent's build: drop an artifact in the worktree, then pass.
    validate: async (wt) => {
      writeFileSync(join(wt, "artifact.txt"), "winner");
      return { ok: true, output: "built" };
    },
  });
  assert.equal(outcome.merged, true);
  assert.equal(readFileSync(join(repoDir, "artifact.txt"), "utf8"), "winner"); // merged into the repo
});
