import assert from "node:assert/strict";
import { test } from "node:test";
import { isQwen3, makeThinkFilter, stripThink, withNoThink } from "./qwen3.js";

test("isQwen3 matches only qwen3 models", () => {
  assert.equal(isQwen3("qwen3:8b"), true);
  assert.equal(isQwen3("Qwen3-8B"), true);
  assert.equal(isQwen3("llama3.1"), false);
  assert.equal(isQwen3("gpt-4o"), false);
});

test("stripThink removes think block and leading whitespace", () => {
  assert.equal(stripThink("<think>\nreasoning\n</think>\n\nHello"), "Hello");
  assert.equal(stripThink("<think></think>Hi"), "Hi");
  assert.equal(stripThink("no reasoning here"), "no reasoning here");
});

test("withNoThink appends /no_think to the last user turn only", () => {
  const out = withNoThink([
    { role: "system", content: "sys" },
    { role: "user", content: "first" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "second" },
  ]);
  assert.equal(out[3].content, "second\n/no_think");
  assert.equal(out[1].content, "first");
  assert.equal(out[0].content, "sys");
});

test("makeThinkFilter swallows a streamed think block then passes through", () => {
  const f = makeThinkFilter();
  // deltas arriving piecemeal, including a split tag
  const chunks = ["<th", "ink>rea", "son</think>", "Hel", "lo"];
  const visible = chunks.map(f).join("");
  assert.equal(visible, "Hello");
});

test("makeThinkFilter passes through when there is no think block", () => {
  const f = makeThinkFilter();
  assert.equal(["Just ", "an ", "answer"].map(f).join(""), "Just an answer");
});
