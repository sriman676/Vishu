import assert from "node:assert/strict";
import { test } from "node:test";
import { visionProvider } from "./factory.js";

const env = (o: Record<string, string | undefined>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

test("visionProvider is undefined unless both the local base URL and a vision model are set", () => {
  assert.equal(visionProvider(env({})), undefined);
  assert.equal(visionProvider(env({ VISHU_LOCAL_BASE_URL: "http://127.0.0.1:11434" })), undefined);
  assert.equal(visionProvider(env({ VISHU_VISION_MODEL: "moondream" })), undefined);
});

test("visionProvider forces the vision model (not the caller's) so a text-only bound model can't hijack it", async () => {
  const p = visionProvider(env({ VISHU_LOCAL_BASE_URL: "http://127.0.0.1:11434", VISHU_VISION_MODEL: "moondream" }));
  assert.ok(p);
  assert.equal(p.local, true, "a vision call is eligible for the local key-mode");
  // bindModel overrides req.model — intercept the outbound fetch to prove moondream is what ships.
  const orig = globalThis.fetch;
  let sentModel = "";
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sentModel = JSON.parse(init.body).model;
    return { ok: true, json: async () => ({ message: { content: "a red circle" } }) } as unknown as Response;
  }) as typeof fetch;
  try {
    await p.chat({ model: "qwen3:4b", messages: [{ role: "user", content: "what is this", images: ["ZGF0YQ=="] }], category: "vision" });
  } finally {
    globalThis.fetch = orig;
  }
  assert.equal(sentModel, "moondream", "the vision endpoint ignores the caller's model and uses VISHU_VISION_MODEL");
});
