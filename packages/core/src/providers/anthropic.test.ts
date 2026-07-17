import assert from "node:assert/strict";
import { test } from "node:test";
import { AnthropicProvider } from "./anthropic.js";

/** Capture the request body a chat() call would POST, returning a canned Anthropic response. */
function stubFetch(reply: unknown): { body: () => Record<string, unknown>; restore: () => void } {
  const orig = globalThis.fetch;
  let captured: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    captured = JSON.parse(init.body);
    return { ok: true, json: async () => reply } as Response;
  }) as typeof fetch;
  return { body: () => captured, restore: () => { globalThis.fetch = orig; } };
}

test("anthropic: thinking budget is sent and max_tokens is floored above it", async () => {
  const f = stubFetch({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
  const p = new AnthropicProvider({ baseUrl: "http://x", apiKey: "k" });
  await p.chat({ model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 1000, thinking: { budgetTokens: 4000 } });
  f.restore();
  assert.deepEqual(f.body().thinking, { type: "enabled", budget_tokens: 4000 });
  assert.equal(f.body().max_tokens, 5024); // floored to budget + 1024, above the requested 1000
});

test("anthropic: no thinking field when unset; thinking blocks are not surfaced as content/tool calls", async () => {
  const f = stubFetch({
    content: [{ type: "thinking", thinking: "secret reasoning" }, { type: "text", text: "answer" }],
    stop_reason: "end_turn",
  });
  const p = new AnthropicProvider({ baseUrl: "http://x", apiKey: "k" });
  const res = await p.chat({ model: "m", messages: [{ role: "user", content: "hi" }] });
  f.restore();
  assert.equal("thinking" in f.body(), false);
  assert.equal(res.content, "answer"); // thinking block dropped, only text kept
  assert.equal(res.toolCalls, undefined);
});
