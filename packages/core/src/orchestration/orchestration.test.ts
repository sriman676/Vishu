import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EchoProvider, ScriptedProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import type { ChatResponse, Provider } from "../providers/types.js";
import { makePolicy } from "../security/policy.js";
import { registerBuiltins } from "../tools/builtins.js";
import { ToolRegistry } from "../tools/registry.js";
import type { Tool } from "../tools/types.js";
import { SkillIndex } from "../skills/index.js";
import { ARCHETYPES, narrowRegistry, narrowTier, synthesizeArchetype } from "./archetypes.js";
import { council, mixtureOfAgents } from "./council.js";
import { Coordinator } from "./coordinator.js";
import { AgentFactory } from "./factory.js";
import { ModeManager } from "./modes.js";
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

test("synthesizeArchetype: a novel task yields tools ⊆ parent registry (never widens, never empty)", () => {
  const parent = registerBuiltins(new ToolRegistry());
  const parentNames = new Set(parent.schemas().map((s) => s.name));

  const arch = synthesizeArchetype("read the config file and search the web for the answer", parent);
  const tools = arch.tools as string[];
  assert.ok(tools.length > 0, "synthesized toolset is never empty");
  assert.ok(tools.every((t) => parentNames.has(t)), "every tool is one the parent has (⊆ parent)");
  assert.ok(tools.includes("read_file") && tools.includes("web_search"), "keyword-relevant tools selected");

  // narrowRegistry enforces the ⊆-parent invariant a second time.
  const child = narrowRegistry(parent, arch);
  assert.ok(child.schemas().every((s) => parentNames.has(s.name)));

  // A task with no tool-relevant keywords falls back to the parent's read-only core, still ⊆ parent.
  const fallback = synthesizeArchetype("ponder existential questions quietly", parent);
  const fbTools = fallback.tools as string[];
  assert.ok(fbTools.length > 0 && fbTools.every((t) => parentNames.has(t)));
  assert.ok(!fbTools.includes("run_shell") && !fbTools.includes("write_file"), "fallback is read-only");
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

test("dispatch: routes to preset archetype | synthesized | clarify", () => {
  const coordinator = new Coordinator({
    router: new Router([new EchoProvider()]),
    model: "mock",
    parentPolicy: makePolicy("full", mkdtempSync(join(tmpdir(), "vishu-disp-"))),
    parentRegistry: registerBuiltins(new ToolRegistry()),
    repoDir: mkdtempSync(join(tmpdir(), "vishu-disp-")),
  });

  const review = coordinator.dispatch("review the auth module and run the tests");
  assert.equal(review.kind, "archetype");
  assert.equal(review.kind === "archetype" && review.archetype.name, "critic");

  const build = coordinator.dispatch("implement a login form in the app");
  assert.equal(build.kind === "archetype" && build.archetype.name, "coder");

  const novel = coordinator.dispatch("translate this telugu paragraph into english");
  assert.equal(novel.kind, "synthesized"); // matches no preset keyword → bespoke archetype

  const vague = coordinator.dispatch("do it");
  assert.equal(vague.kind, "clarify"); // too brief → one clarifying question, not a guess
  assert.match(vague.kind === "clarify" ? vague.question : "", /too brief/);
});

test("dispatch: a factory-approved agent named in the task is routed to, ahead of presets (Step 5 loop)", async () => {
  const parent = registerBuiltins(new ToolRegistry());
  const factory = new AgentFactory(parent, new SkillIndex(), { ask: async () => true });
  await factory.approveAndRegister(factory.propose("telugu-translator", "translate telugu text to english"));

  const coordinator = new Coordinator({
    router: new Router([new EchoProvider()]),
    model: "mock",
    parentPolicy: makePolicy("full", mkdtempSync(join(tmpdir(), "vishu-fac-"))),
    parentRegistry: parent,
    repoDir: mkdtempSync(join(tmpdir(), "vishu-fac-")),
    factory,
  });

  const named = coordinator.dispatch("please run telugu-translator on this paragraph");
  assert.equal(named.kind, "archetype");
  assert.equal(named.kind === "archetype" && named.archetype.name, "telugu-translator", "approved agent wins over any preset");

  // Routing recall: a task that DESCRIBES the agent's job (without naming it) reaches it too.
  const described = coordinator.dispatch("translate this telugu paragraph into english");
  assert.equal(described.kind === "archetype" && described.archetype.name, "telugu-translator", "describe-not-name still routes to the bespoke agent");

  // A task with no overlap is NOT hijacked — it synthesizes a fresh agent.
  const novel = coordinator.dispatch("compose a haiku about the ocean at dawn");
  assert.equal(novel.kind, "synthesized");

  // dispatchAndRun on a too-vague task returns the clarifying question without executing anything.
  assert.match(await coordinator.dispatchAndRun("do it"), /too brief/);
});

test("dispatch: a persona request routes to a mode switch, not a subagent (Phase-4 mode arm)", async () => {
  const modes = new ModeManager({ ask: async () => false });
  const coordinator = new Coordinator({
    router: new Router([new EchoProvider()]),
    model: "mock",
    parentPolicy: makePolicy("full", mkdtempSync(join(tmpdir(), "vishu-mode-"))),
    parentRegistry: registerBuiltins(new ToolRegistry()),
    repoDir: mkdtempSync(join(tmpdir(), "vishu-mode-")),
    modes,
  });

  // explicit mode name mentioned → route to that mode
  const named = coordinator.dispatch("switch to interviewer mode for system design");
  assert.equal(named.kind, "mode");
  assert.equal(named.kind === "mode" && named.mode, "interviewer");

  // intent keyword ("teach me") → teacher mode, after preset rules so a clear build intent isn't hijacked
  const intent = coordinator.dispatch("teach me how binary search works");
  assert.equal(intent.kind === "mode" && intent.mode, "teacher");

  // a clear build intent still routes to the coder preset even with modes present
  assert.equal(coordinator.dispatch("implement a login form in the app").kind, "archetype");

  // dispatchAndRun actually flips the active persona
  assert.match(await coordinator.dispatchAndRun("interview me about databases"), /interviewer/);
  assert.equal(modes.active().name, "interviewer");
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

test("subagent retries once after a mid-run crash, then succeeds", async () => {
  let calls = 0;
  const crashOnce: Provider = {
    name: "crash-once",
    async chat(): Promise<ChatResponse> {
      if (calls++ === 0) throw new Error("boom"); // first attempt crashes mid-run
      return { content: "recovered", finish: "stop" };
    },
    chatStream(req) {
      return this.chat(req);
    },
  };
  const outcome = await runSubagent({
    archetype: ARCHETYPES.coder!,
    task: "do the thing",
    parentContext: "ctx",
    parentPolicy: makePolicy("full", mkdtempSync(join(tmpdir(), "vishu-retry-"))),
    parentRegistry: registerBuiltins(new ToolRegistry()),
    router: new Router([crashOnce]),
    model: "mock",
    repoDir: mkdtempSync(join(tmpdir(), "vishu-retry-")),
  });
  assert.equal(outcome.final, "recovered");
  assert.equal(calls, 2); // crashed once, retried once — exactly one retry
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

test("harvest: a run that changes nothing is not merged — no empty harvest commit (UPGRADES §7)", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "vishu-harvest-empty-"));
  const outcome = await runSubagent({
    archetype: ARCHETYPES.researcher!, // read-only archetype — produces no diff
    task: "look but don't touch",
    parentContext: "ctx",
    parentPolicy: makePolicy("full", repoDir),
    parentRegistry: registerBuiltins(new ToolRegistry()),
    router: new Router([new EchoProvider()]),
    model: "mock",
    repoDir,
    harvest: true,
    validate: async () => ({ ok: true, output: "reviewed" }), // passes, writes nothing
  });
  assert.equal(outcome.merged, false); // clean worktree → nothing harvested
});

test("subagent honours an `ask`: a send-class tool runs only when approval says yes (UPGRADES §4)", async () => {
  let ran = false;
  const sender: Tool = {
    name: "fake_send",
    description: "test send",
    parameters: { type: "object", properties: {} },
    meta: { action: "send" }, // NEVER_WITHOUT_ASKING → always routes through the gate
    async run() { ran = true; return "SENT"; },
  };
  const archetype = { name: "sender", system: "you send", tools: ["fake_send"] };
  const run = (ask?: (r: unknown) => Promise<boolean>) => {
    ran = false;
    const parent = new ToolRegistry();
    parent.register(sender);
    // turn 1: call fake_send; turn 2: finish.
    const router = new Router([new ScriptedProvider([
      { content: "", toolCalls: [{ id: "1", name: "fake_send", arguments: {} }], finish: "tool_calls" },
      { content: "done", finish: "stop" },
    ])]);
    return runSubagent({
      archetype, task: "send it", parentContext: "ctx",
      parentPolicy: makePolicy("full", mkdtempSync(join(tmpdir(), "vishu-ask-"))),
      parentRegistry: parent, router, model: "mock",
      repoDir: mkdtempSync(join(tmpdir(), "vishu-ask-")),
      ask: ask as never,
    });
  };

  await run(async () => true);
  assert.equal(ran, true, "approved send should execute");

  await run(); // no ask → fail-closed deny
  assert.equal(ran, false, "unapproved send must be denied");
});
