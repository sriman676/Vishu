import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPoolRouter } from "./factory.js";
import { ScriptedProvider } from "./mock.js";
import { Router } from "./router.js";
import { type Provider, ProviderError } from "./types.js";

const req = { model: "m", messages: [{ role: "user" as const, content: "hi" }] };

/** A provider that answers with its own name, so a test can see which endpoint handled each call. */
const named = (name: string, local = false): Provider => ({
  name,
  local,
  chat: async () => ({ content: name, finish: "stop" }),
  chatStream: async (_r, onDelta) => (onDelta(name), { content: name, finish: "stop" }),
});

test("router fails over to the next key on a transient error", async () => {
  const dead = new ScriptedProvider([new ProviderError("429 quota", true, 429)], "key0");
  const live = new ScriptedProvider([{ content: "ok", finish: "stop" }], "key1");
  const res = await new Router([dead, live]).chat(req);
  assert.equal(res.content, "ok");
});

test("router surfaces a fatal (non-transient) error immediately", async () => {
  const bad = new ScriptedProvider([new ProviderError("401 bad key", false, 401)], "key0");
  const live = new ScriptedProvider([{ content: "ok", finish: "stop" }], "key1");
  await assert.rejects(new Router([bad, live]).chat(req), /401/);
});

test("balance mode round-robins calls across all keys", async () => {
  const r = new Router([named("a"), named("b"), named("c")], undefined, undefined, "balance");
  const seen = [(await r.chat(req)).content, (await r.chat(req)).content, (await r.chat(req)).content, (await r.chat(req)).content];
  assert.deepEqual(seen, ["a", "b", "c", "a"]); // spreads, then wraps
});

test("local mode routes only to local endpoints when present", async () => {
  const r = new Router([named("cloud1"), named("cloud2"), named("gpu", true), named("npu", true)], undefined, undefined, "local");
  const seen = [(await r.chat(req)).content, (await r.chat(req)).content, (await r.chat(req)).content];
  assert.deepEqual(seen, ["gpu", "npu", "gpu"]); // cloud keys idle; rotates over local only
});

test("local mode falls back to all endpoints when none are local", async () => {
  const r = new Router([named("a"), named("b")], undefined, undefined, "local");
  assert.equal((await r.chat(req)).content, "a"); // no local → uses the full ring
});

/** A provider that 404s for a dead model but answers `<model>:ok` for anything else — lets a test
 * see the Router reroute from a gone/timing-out model down to a working one. */
const modelAware = (deadModels: Record<string, ProviderError>): Provider => ({
  name: "nim",
  chat: async (r) => {
    const err = deadModels[r.model];
    if (err) throw err;
    return { content: `${r.model}:ok`, finish: "stop" };
  },
  chatStream: async (r, onDelta) => {
    const err = deadModels[r.model];
    if (err) throw err;
    return onDelta(r.model), { content: `${r.model}:ok`, finish: "stop" };
  },
});

test("router reroutes to the next model when the requested model is gone (404)", async () => {
  const ep = modelAware({ big: new ProviderError("404 not found", false, 404) });
  const r = new Router([ep], undefined, undefined, "failover", undefined, ["mid", "small"]);
  assert.equal((await r.chat({ ...req, model: "big" })).content, "mid:ok"); // big 404s → reroute to mid
});

test("router reroutes on a timeout down the model chain", async () => {
  const ep = modelAware({
    big: new ProviderError("aborted timeout", true, 504),
    mid: new ProviderError("410 gone", false, 410),
  });
  const r = new Router([ep], undefined, undefined, "failover", undefined, ["mid", "small"]);
  assert.equal((await r.chat({ ...req, model: "big" })).content, "small:ok"); // big timeout, mid gone → small
});

test("router does NOT reroute on a model-independent fatal (401), even with fallbacks", async () => {
  const ep = modelAware({ big: new ProviderError("401 bad key", false, 401) });
  const r = new Router([ep], undefined, undefined, "failover", undefined, ["mid"]);
  await assert.rejects(r.chat({ ...req, model: "big" }), /401/); // auth error surfaces, no reroute
});

test("buildPoolRouter spans multiple named providers and round-trips; empty throws", async () => {
  const mockCfg = { type: "mock" as const, model: "mock", baseUrl: "", apiKeys: [], keyLabels: [] };
  const pool = buildPoolRouter({ a: mockCfg, b: mockCfg });
  assert.match((await pool.chat(req)).content, /hi/); // echoes through a pooled endpoint
  assert.throws(() => buildPoolRouter({}), /no providers/);
});
