import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MODES } from "../orchestration/modes.js";
import type { ChatResponse, Provider } from "../providers/types.js";
import { critiquePrompts } from "./critique.js";
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
