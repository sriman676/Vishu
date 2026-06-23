import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryStore } from "../memory/store.js";
import { ScriptedProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import { ToolRegistry } from "../tools/registry.js";
import { EventBus } from "../transport/events.js";
import { LocalConnector } from "./local.js";
import { McpClient, registerMcpTools } from "./mcp.js";
import { registerConnectors } from "./rpc.js";
import { handleInbound, parseTriage } from "./triage.js";
import { Registry } from "../transport/rpc.js";

/** A 20-line stdio MCP server: initialize, tools/list (one `add` tool), tools/call. */
const STUB_SERVER = `
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.method === "initialize") reply(m.id, { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "stub", version: "0" } });
    else if (m.method === "tools/list") reply(m.id, { tools: [{ name: "add", description: "add two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } }] });
    else if (m.method === "tools/call") { if (m.params.name === "boom") process.exit(1); reply(m.id, { content: [{ type: "text", text: String(m.params.arguments.a + m.params.arguments.b) }] }); }
    else if (m.method === "resources/list") reply(m.id, { resources: [{ uri: "mem://note", name: "note" }] });
    else if (m.method === "resources/read") reply(m.id, { contents: [{ uri: m.params.uri, text: "hello from " + m.params.uri }] });
    else if (m.method === "prompts/list") reply(m.id, { prompts: [{ name: "greet", arguments: [{ name: "who", required: true }] }] });
    else if (m.method === "prompts/get") reply(m.id, { messages: [{ role: "user", content: { type: "text", text: "hi " + m.params.arguments.who } }] });
    else if (m.id !== undefined) reply(m.id, {});
  }
});
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n"); }
`;

test("MCP: an external server's tool registers and is callable through the registry", async () => {
  const script = join(mkdtempSync(join(tmpdir(), "vishu-mcp-")), "server.mjs");
  writeFileSync(script, STUB_SERVER);
  const client = new McpClient(process.execPath, [script]);
  await client.start();
  try {
    const registry = new ToolRegistry();
    const bus = new EventBus();
    const synced: unknown[] = [];
    bus.subscribeDomain("tool", (e) => synced.push(e.payload));

    const names = await registerMcpTools(registry, client, "stub", bus);
    assert.deepEqual(names, ["stub__add"]);
    assert.equal(synced.length, 1); // tool:sync broadcast

    const out = await registry.get("stub__add").run({ a: 2, b: 3 }, {} as never);
    assert.equal(out, "5"); // round-trip: registry → MCP tools/call → server → back
  } finally {
    client.stop();
  }
});

test("MCP: resources and prompts list/read/get round-trip", async () => {
  const script = join(mkdtempSync(join(tmpdir(), "vishu-mcp-rp-")), "server.mjs");
  writeFileSync(script, STUB_SERVER);
  const client = new McpClient(process.execPath, [script]);
  await client.start();
  try {
    assert.deepEqual(await client.listResources(), [{ uri: "mem://note", name: "note" }]);
    assert.equal(await client.readResource("mem://note"), "hello from mem://note");
    assert.deepEqual(await client.listPrompts(), [{ name: "greet", arguments: [{ name: "who", required: true }] }]);
    assert.deepEqual(await client.getPrompt("greet", { who: "vishu" }), [
      { role: "user", content: { type: "text", text: "hi vishu" } },
    ]);
  } finally {
    client.stop();
  }
});

test("MCP: auto-reconnect respawns the server after an unexpected close", async () => {
  const script = join(mkdtempSync(join(tmpdir(), "vishu-mcp-rc-")), "server.mjs");
  writeFileSync(script, STUB_SERVER);
  const client = new McpClient(process.execPath, [script], { reconnect: true });
  await client.start();
  try {
    await assert.rejects(client.callTool("boom", {})); // server exits → in-flight request rejects
    await new Promise((r) => setTimeout(r, 800)); // wait past the 500ms reconnect backoff
    assert.deepEqual(await client.listTools(), [
      { name: "add", description: "add two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
    ]); // re-initialized client serves requests again
  } finally {
    client.stop();
  }
});

test("triage parsing: reads SUMMARY/TIER, defaults to info on a malformed reply", () => {
  assert.deepEqual(parseTriage("SUMMARY: server is down\nTIER: urgent"), { summary: "server is down", tier: "urgent" });
  assert.equal(parseTriage("garbage").tier, "info"); // never drops a message
});

test("inbound: an urgent message gets a summary + tier, files a vault task, and notifies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-inbound-"));
  const memory = new MemoryStore(join(dir, "vault"), join(dir, "mem.db"));
  const bus = new EventBus();
  const notified: unknown[] = [];
  bus.subscribeDomain("system", (e) => e.type === "notification" && notified.push(e.payload));
  const router = new Router([new ScriptedProvider([{ content: "SUMMARY: prod is on fire\nTIER: urgent", finish: "stop" }])]);

  const triage = await handleInbound(
    { router, model: "mock", memory, bus },
    { channel: "email", from: "ops@x.com", text: "Everything is 500ing", id: "m1" },
  );

  assert.equal(triage.tier, "urgent");
  assert.match(triage.summary, /on fire/);
  assert.equal(notified.length, 1); // urgent → notification published
  assert.match((await memory.recall("prod fire 500")).text, /on fire/); // task filed in the vault
  memory.close();
});

test("outbound: connectors_send dispatches a reply through the registered connector", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-out-"));
  const memory = new MemoryStore(join(dir, "vault"), join(dir, "mem.db"));
  const local = new LocalConnector();
  const registry = new Registry();
  registerConnectors(
    registry,
    { router: new Router([new ScriptedProvider([])]), model: "mock", memory, bus: new EventBus() },
    new Map([["local", local]]),
  );

  const res = await registry.handle({ jsonrpc: "2.0", id: 1, method: "vishu.connectors_send", params: { channel: "local", to: "u1", text: "hi" } });
  assert.deepEqual(res.result, { ok: true, result: { sent: true } });
  assert.deepEqual(local.outbox, [{ to: "u1", text: "hi" }]); // reply dispatched

  const miss = await registry.handle({ jsonrpc: "2.0", id: 2, method: "vishu.connectors_send", params: { channel: "nope", to: "x", text: "y" } });
  assert.equal(miss.result?.ok, false); // unknown channel → typed error
  memory.close();
});
