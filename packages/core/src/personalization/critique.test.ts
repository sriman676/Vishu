import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MODES } from "../orchestration/modes.js";
import type { ChatResponse, Provider } from "../providers/types.js";
import { critiquePrompts, critiquePromptsCouncil } from "./critique.js";
import { ProjectEvolver } from "./evolve.js";

const stub = (reply: string): Provider => {
  const res: ChatResponse = { content: reply, finish: "stop" };
  return { name: "stub", chat: async () => res, chatStream: async () => res };
};

test("critiquePrompts emits one critique per mode, skipping 'ok'", async () => {
  const suggested = await critiquePrompts(stub("Add a guardrail about deleting files."), "m");
  assert.equal(suggested.length, Object.keys(MODES).length);
  assert.ok(suggested.every((p) => p.kind === "critique" && p.sig.startsWith("critique:mode:")));

  assert.equal((await critiquePrompts(stub("ok"), "m")).length, 0); // a clean prompt yields nothing
});

test("critique proposals ride the evolve gate and dedupe by sig", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-critique-"));
  const evolver = new ProjectEvolver(join(dir, "evolve.json"));
  const found = await critiquePrompts(stub("Tighten the send-confirmation wording."), "m");

  assert.equal(evolver.record(found).length, found.length); // first pass records them all
  assert.equal(evolver.record(found).length, 0); // second pass: same sigs, nothing new
  assert.ok(evolver.pending().every((p) => p.kind === "critique" && p.status === "pending"));
});

test("council v2 emits only consensus critiques, ranked, tagged with the vote count", async () => {
  // 2 of 3 members flag, 1 says ok → majority (2) reached → one proposal per mode.
  const quorum = [
    { model: "a", provider: stub("Add a delete guardrail.") },
    { model: "b", provider: stub("Clarify the send-confirmation step.") },
    { model: "c", provider: stub("ok") },
  ];
  const out = await critiquePromptsCouncil(quorum);
  assert.equal(out.length, Object.keys(MODES).length);
  assert.ok(out.every((p) => p.kind === "critique" && p.detail.startsWith("[consensus 2/3]")));

  // only 1 of 3 flags → below majority → no proposal (consensus is the point).
  const noQuorum = [
    { model: "a", provider: stub("some nitpick") },
    { model: "b", provider: stub("ok") },
    { model: "c", provider: stub("ok") },
  ];
  assert.equal((await critiquePromptsCouncil(noQuorum)).length, 0);
  assert.equal((await critiquePromptsCouncil([])).length, 0); // empty council → nothing
});

test("a council member that throws casts a no-vote instead of breaking the run", async () => {
  const throwing = { name: "x", chat: async () => { throw new Error("provider down"); }, chatStream: async () => { throw new Error("x"); } };
  const council = [
    { model: "a", provider: stub("Add a guardrail.") },
    { model: "b", provider: stub("Add a guardrail.") },
    { model: "c", provider: throwing },
  ];
  const out = await critiquePromptsCouncil(council); // 2 real flags + 1 error(no-vote) → still quorum
  assert.ok(out.length > 0 && out.every((p) => p.detail.startsWith("[consensus 2/3]")));
});
