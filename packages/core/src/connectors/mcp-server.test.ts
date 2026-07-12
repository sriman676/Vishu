import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ApprovalGate } from "../reliability/approvals.js";
import { ToolRegistry } from "../tools/registry.js";
import type { Tool, ToolContext } from "../tools/types.js";
import { buildVishuMcpServer } from "./mcp-server.js";

const tool = (name: string, action: "read" | "send", run: Tool["run"]): Tool => ({
  name,
  description: name,
  parameters: { type: "object", properties: { text: { type: "string" } } },
  meta: { action },
  run,
});

async function connect(registry: ToolRegistry) {
  const gate = new ApprovalGate("ask_every_time", async () => false, { actionOf: (n) => registry.getAction(n), isPaused: () => false });
  const server = buildVishuMcpServer(registry, gate, {} as ToolContext);
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  return client;
}

test("MCP server lists tools and runs a safe (read) tool for an external client", async () => {
  const registry = new ToolRegistry();
  registry.register(tool("echo_note", "read", async (args) => `echoed: ${args.text}`));
  const client = await connect(registry);

  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === "echo_note"));

  const res = (await client.callTool({ name: "echo_note", arguments: { text: "hi" } })) as { content: { text: string }[]; isError?: boolean };
  assert.equal(res.isError ?? false, false);
  assert.equal(res.content[0].text, "echoed: hi");
});

test("MCP server fails closed: a send-class tool is denied (no human to approve)", async () => {
  const registry = new ToolRegistry();
  let ran = false;
  registry.register(tool("send_mail", "send", async () => ((ran = true), "sent")));
  const client = await connect(registry);

  const res = (await client.callTool({ name: "send_mail", arguments: { text: "hi" } })) as { content: { text: string }[]; isError?: boolean };
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /denied/);
  assert.equal(ran, false, "the send tool must never execute unattended");
});
