import assert from "node:assert/strict";
import { test } from "node:test";
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
