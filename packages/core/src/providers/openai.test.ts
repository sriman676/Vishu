import assert from "node:assert/strict";
import { test } from "node:test";
import { toOpenAIContent } from "./openai.js";

test("toOpenAIContent: text-only message stays a plain string (byte-identical to before)", () => {
  assert.equal(toOpenAIContent({ role: "user", content: "hello" }), "hello");
  assert.equal(toOpenAIContent({ role: "user", content: "hi", images: [] }), "hi");
});

test("toOpenAIContent: images become a text+image_url parts array", () => {
  const parts = toOpenAIContent({ role: "user", content: "what is this?", images: ["http://x/a.png", "data:image/png;base64,AAA"] });
  assert.deepEqual(parts, [
    { type: "text", text: "what is this?" },
    { type: "image_url", image_url: { url: "http://x/a.png" } },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
  ]);
});

test("toOpenAIContent: image with no text omits the text part", () => {
  const parts = toOpenAIContent({ role: "user", content: "", images: ["http://x/a.png"] });
  assert.deepEqual(parts, [{ type: "image_url", image_url: { url: "http://x/a.png" } }]);
});
