import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ApprovalGate } from "../reliability/approvals.js";
import type { ToolContext } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";

/**
 * Vishu-as-an-MCP-server: exposes the tool registry to any MCP client (Claude Desktop over stdio, or
 * any HTTP client / curl). EVERY external tool call is routed through the SAME ApprovalGate the agent
 * uses. With no human at the terminal the gate's ask() denies, so send/spend/delete/change_setting
 * fail closed — an external client can only ever drive reads + safe writes. Reuses tool.run() verbatim.
 */
export function buildVishuMcpServer(registry: ToolRegistry, gate: ApprovalGate, ctx: ToolContext): Server {
  const server = new Server({ name: "vishu", version: process.env.npm_package_version ?? "0.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.schemas().map((s) => ({ name: s.name, description: s.description, inputSchema: s.parameters as { type: "object" } })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const decision = await gate.decide({ id: name, name, arguments: args });
    if (!decision.allowed) {
      return { content: [{ type: "text", text: `denied: ${decision.reason ?? "not allowed"}` }], isError: true };
    }
    try {
      const out = await registry.get(name).run(args, ctx);
      return { content: [{ type: "text", text: out }] };
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  });

  return server;
}

/** stdio transport — the client (e.g. Claude Desktop) spawns `vishu mcp-serve` and talks over stdin/out. */
export async function serveMcpStdio(server: Server): Promise<void> {
  await server.connect(new StdioServerTransport());
}

/** HTTP (Streamable HTTP) transport — any MCP client or curl can reach it. Binds 127.0.0.1. When `token`
 * is set, an `Authorization: Bearer <token>` is required; unset → open (localhost-only, single user).
 * ponytail: one shared stateless transport (single-session). Spin a transport per session if you need
 * concurrent independent clients. */
export async function serveMcpHttp(server: Server, opts: { port: number; token?: string }): Promise<() => void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (opts.token && req.headers.authorization !== `Bearer ${opts.token}`) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    let body: unknown;
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid json" }));
        return;
      }
    }
    await transport.handleRequest(req, res, body);
  });

  await new Promise<void>((resolve) => http.listen(opts.port, "127.0.0.1", resolve));
  return () => http.close();
}
