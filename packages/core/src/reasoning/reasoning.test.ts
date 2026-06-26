import assert from "node:assert/strict";
import { test } from "node:test";
import { ScriptedProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import type { ChatResponse } from "../providers/types.js";
import { bestOfN } from "./selfconsistency.js";

const r = (content: string): ChatResponse => ({ content, finish: "stop" });
const routerOf = (...replies: string[]): Router => new Router([new ScriptedProvider(replies.map(r))]);

test("vote: the majority answer wins and reports its bucket size", async () => {
  const res = await bestOfN(routerOf("A", "B", "A", "A", "C"), "m", "q", { n: 5 });
  assert.equal(res.chosen, "A");
  assert.equal(res.chosenIndex, 0);
  assert.equal(res.votes, 3);
  assert.equal(res.method, "vote");
});

test("vote: a tie goes to the first-seen answer", async () => {
  const res = await bestOfN(routerOf("A", "B", "A", "B"), "m", "q", { n: 4 });
  assert.equal(res.chosen, "A");
  assert.equal(res.votes, 2);
});

test("judge: the judge's bracket pick selects the candidate", async () => {
  // 3 samples, then the judge reply "1"
  const res = await bestOfN(routerOf("x", "y", "z", "I pick [1]"), "m", "q", { n: 3, select: "judge" });
  assert.equal(res.chosenIndex, 1);
  assert.equal(res.chosen, "y");
  assert.equal(res.method, "judge");
});

test("N=1 is degenerate: the single sample is returned", async () => {
  const res = await bestOfN(routerOf("solo"), "m", "q", { n: 1 });
  assert.equal(res.chosen, "solo");
  assert.equal(res.candidates.length, 1);
  assert.equal(res.votes, 1);
});
