import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EchoProvider, ScriptedProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import { makePolicy } from "../security/policy.js";
import { registerBuiltins } from "../tools/builtins.js";
import { ToolRegistry } from "../tools/registry.js";
import { ARCHETYPES, narrowRegistry, narrowTier } from "./archetypes.js";
import { Coordinator } from "./coordinator.js";
import { NoParentContextError, runSubagent } from "./subagent.js";

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
