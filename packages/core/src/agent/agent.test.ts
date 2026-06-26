import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ScriptedProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import { makePolicy } from "../security/policy.js";
import { registerBuiltins } from "../tools/builtins.js";
import { ToolRegistry } from "../tools/registry.js";
import { Terminal } from "../tools/terminal.js";
import { initToken } from "../transport/auth.js";
import { rpcCall } from "../transport/client.js";
import { Registry } from "../transport/rpc.js";
import { startServer } from "../transport/server.js";
import { DigitalTwin } from "../personalization/twin.js";
import { registerAgent } from "./rpc.js";
import { AgentService } from "./service.js";

test("a frontend-shaped client drives a full agent turn over RPC", async () => {
  const token = initToken(mkdtempSync(join(tmpdir(), "vishu-ws-")));
  const actionDir = mkdtempSync(join(tmpdir(), "vishu-act-"));
  const service = new AgentService({
    router: new Router([new ScriptedProvider([{ content: "hi from agent", finish: "stop" }])]),
    tools: registerBuiltins(new ToolRegistry()),
    policy: makePolicy("full", actionDir),
    terminal: new Terminal(actionDir),
    model: "scripted",
  });
  const registry = new Registry();
  registerAgent(registry, service);
  const server = await startServer(registry, "127.0.0.1", 0);
  const base = `http://127.0.0.1:${server.port}`;

  try {
    const turn = await rpcCall(base, token, "vishu.agent_start_turn", { message: "hello" });
    assert.equal(turn.result?.ok, true);
    const r = (turn.result as { result: { sessionId: string; final: string } }).result;
    assert.equal(r.final, "hi from agent");

    const transcript = await rpcCall(base, token, "vishu.agent_transcript", { sessionId: r.sessionId });
    const msgs = (transcript.result as { result: unknown[] }).result;
    assert.ok(msgs.length >= 3); // system + user + assistant
  } finally {
    await server.close();
  }
});

test("startTurn auto-records the user prompt into the digital twin", async () => {
  const actionDir = mkdtempSync(join(tmpdir(), "vishu-act-"));
  const twin = new DigitalTwin(join(mkdtempSync(join(tmpdir(), "vishu-twin-")), "twin.json"));
  const service = new AgentService({
    router: new Router([new ScriptedProvider([{ content: "ok", finish: "stop" }, { content: "ok", finish: "stop" }, { content: "ok", finish: "stop" }])]),
    tools: registerBuiltins(new ToolRegistry()),
    policy: makePolicy("full", actionDir),
    terminal: new Terminal(actionDir),
    model: "scripted",
    twin,
  });
  await service.startTurn(undefined, "deploy the app");
  await service.startTurn(undefined, "Deploy the app"); // same task, different case → same signature
  await service.startTurn(undefined, "deploy the app");
  assert.deepEqual(twin.suggestions(3), ["deploy the app"]); // 3 repeats crossed the threshold, unattended
});
