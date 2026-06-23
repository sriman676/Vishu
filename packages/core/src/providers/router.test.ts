import assert from "node:assert/strict";
import { test } from "node:test";
import { ScriptedProvider } from "./mock.js";
import { Router } from "./router.js";
import { ProviderError } from "./types.js";

const req = { model: "m", messages: [{ role: "user" as const, content: "hi" }] };

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
