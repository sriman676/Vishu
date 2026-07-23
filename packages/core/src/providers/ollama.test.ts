import assert from "node:assert/strict";
import { test } from "node:test";
import { OllamaProvider } from "./ollama.js";

/** Capture the request body a chat() call POSTs, returning a canned Ollama response. */
function stubFetch(reply: unknown): { body: () => Record<string, unknown>; restore: () => void } {
  const orig = globalThis.fetch;
  let captured: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    captured = JSON.parse(init.body);
    return { ok: true, json: async () => reply } as Response;
  }) as typeof fetch;
  return { body: () => captured, restore: () => { globalThis.fetch = orig; } };
}

test("ollama: qwen3 gets think:false + /no_think, and <think> is stripped from the reply", async () => {
  const f = stubFetch({ message: { content: "<think>reasoning</think>\n\nHello" } });
  const p = new OllamaProvider({ baseUrl: "http://x" });
  const res = await p.chat({ model: "qwen3:4b", messages: [{ role: "user", content: "hi" }] });
  f.restore();
  assert.equal(f.body().think, false);
  const msgs = f.body().messages as { content: string }[];
  assert.equal(msgs[0].content, "hi\n/no_think");
  assert.equal(res.content, "Hello"); // think block removed
});

test("ollama: non-qwen3 model is untouched (no think field, no /no_think)", async () => {
  const f = stubFetch({ message: { content: "plain" } });
  const p = new OllamaProvider({ baseUrl: "http://x" });
  const res = await p.chat({ model: "llama3.1:8b", messages: [{ role: "user", content: "hi" }] });
  f.restore();
  assert.equal("think" in f.body(), false);
  const msgs = f.body().messages as { content: string }[];
  assert.equal(msgs[0].content, "hi");
  assert.equal(res.content, "plain");
});
