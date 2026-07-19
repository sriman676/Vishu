import assert from "node:assert/strict";
import { test } from "node:test";
import { isChatModel, parseParams, pickBestNimModels, rankModels } from "./nimcatalog.js";

test("parseParams reads the largest advertised param count from an id", () => {
  assert.equal(parseParams("meta/llama-3.1-70b-instruct"), 70); // 3.1 is not params; 70b is
  assert.equal(parseParams("mistralai/mistral-large-3-675b-instruct-2512"), 675);
  assert.equal(parseParams("nvidia/llama-3.1-nemotron-ultra-253b-v1"), 253);
  assert.equal(parseParams("mixtral-8x22b-v0.1"), 22); // per-expert; MoE effective size not computed
  assert.equal(parseParams("meta/llama-3.1-8b-instruct"), 8);
  assert.equal(parseParams("some/random-model"), 0); // untagged
});

test("isChatModel keeps instruct/reasoning models, drops vision/embed/guard/code", () => {
  assert.equal(isChatModel("meta/llama-3.1-70b-instruct"), true);
  assert.equal(isChatModel("nvidia/llama-3.3-nemotron-super-49b-v1"), true);
  assert.equal(isChatModel("meta/llama-3.2-90b-vision-instruct"), false); // vision
  assert.equal(isChatModel("meta/codellama-70b"), false); // code
  assert.equal(isChatModel("meta/llama-guard-4-12b"), false); // safety guard
  assert.equal(isChatModel("bigcode/starcoder2-15b"), false); // code
});

test("rankModels orders chat models by params, largest first", () => {
  const ranked = rankModels([
    "meta/llama-3.1-8b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.2-90b-vision-instruct", // dropped (vision)
    "nvidia/llama-3.3-nemotron-super-49b-v1",
    "meta/llama-3.1-70b-instruct",
  ]);
  assert.deepEqual(ranked, [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.1-70b-instruct",
    "nvidia/llama-3.3-nemotron-super-49b-v1",
    "meta/llama-3.1-8b-instruct",
  ]);
});

test("pickBestNimModels skips listed-but-dead big models and picks the largest that ANSWERS", async () => {
  const catalogue = [
    "mistralai/mistral-large-3-675b-instruct-2512", // listed, dead
    "nvidia/llama-3.1-nemotron-ultra-253b-v1", // listed, dead
    "meta/llama-3.1-70b-instruct", // works
    "nvidia/llama-3.3-nemotron-super-49b-v1", // works
    "meta/llama-3.1-8b-instruct", // works (tail)
  ];
  const alive = new Set(["meta/llama-3.1-70b-instruct", "nvidia/llama-3.3-nemotron-super-49b-v1", "meta/llama-3.1-8b-instruct"]);
  const chain = await pickBestNimModels(
    async () => catalogue,
    async (id) => alive.has(id),
    { want: 3 },
  );
  assert.equal(chain.builder, "meta/llama-3.1-70b-instruct"); // 675b/253b listed but don't answer → skipped
  assert.deepEqual(chain.fallbacks, [
    "meta/llama-3.1-70b-instruct",
    "nvidia/llama-3.3-nemotron-super-49b-v1",
    "meta/llama-3.1-8b-instruct",
  ]);
});

test("pickBestNimModels auto-promotes to a bigger model the moment it starts answering", async () => {
  const catalogue = ["mistralai/mistral-large-3-675b-instruct-2512", "meta/llama-3.1-70b-instruct", "meta/llama-3.1-8b-instruct"];
  const chain = await pickBestNimModels(async () => catalogue, async () => true, { want: 2 }); // now everything answers
  assert.equal(chain.builder, "mistralai/mistral-large-3-675b-instruct-2512"); // promoted to the 675b
});

test("pickBestNimModels never dead-ends: falls back to the small tail when nothing large answers", async () => {
  const chain = await pickBestNimModels(async () => ["mistralai/mistral-large-3-675b-instruct-2512"], async () => false);
  assert.deepEqual(chain.fallbacks, ["meta/llama-3.1-8b-instruct"]); // tail guaranteed
  assert.equal(chain.builder, "meta/llama-3.1-8b-instruct");
});
