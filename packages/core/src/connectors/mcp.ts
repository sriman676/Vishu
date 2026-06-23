import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { ToolRegistry } from "../tools/registry.js";
import type { EventBus } from "../transport/events.js";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}

export interface McpPromptMessage {
  role: string;
  content: { type: string; text?: string };
}

interface RpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Handles a server-initiated `sampling/createMessage` request by calling back into our LLM.
 * Returns the MCP CreateMessageResult (e.g. `{ role, content: { type:"text", text }, model }`). */
export type McpSampler = (params: unknown) => Promise<unknown>;

/** Minimal MCP client over the standard stdio transport: newline-delimited JSON-RPC 2.0 to a spawned
 * server process. Covers initialize → tools/list+call, resources/list+read, prompts/list+get, and
 * auto-reconnect on unexpected close, plus server-initiated `sampling/createMessage` (handled via an
 * injected `sampler` that calls back into our LLM). */
export class McpClient {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buf = "";
  private stopped = false;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(
    private readonly cmd: string,
    private readonly args: string[] = [],
    private readonly opts: { reconnect?: boolean; sampler?: McpSampler } = {},
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    const child = spawn(this.cmd, this.args, { stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => this.onData(d));
    child.on("error", (e) => this.failAll(e));
    child.on("close", () => this.onClose());
    this.child = child;
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vishu", version: "0" },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpTool[]> {
    const res = (await this.request("tools/list", {})) as { tools?: McpTool[] };
    return res.tools ?? [];
  }

  /** Call a tool; flatten the MCP content blocks into a single text string. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = (await this.request("tools/call", { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = (res.content ?? []).map((c) => c.text ?? "").join("\n");
    return res.isError ? `error: ${text}` : text;
  }

  async listResources(): Promise<McpResource[]> {
    const res = (await this.request("resources/list", {})) as { resources?: McpResource[] };
    return res.resources ?? [];
  }

  /** Read a resource; flatten its text contents into one string (blobs are skipped). */
  async readResource(uri: string): Promise<string> {
    const res = (await this.request("resources/read", { uri })) as {
      contents?: { uri: string; text?: string }[];
    };
    return (res.contents ?? []).map((c) => c.text ?? "").join("\n");
  }

  async listPrompts(): Promise<McpPrompt[]> {
    const res = (await this.request("prompts/list", {})) as { prompts?: McpPrompt[] };
    return res.prompts ?? [];
  }

  /** Get a prompt template, filled with `args`; returns its message list. */
  async getPrompt(name: string, args: Record<string, unknown> = {}): Promise<McpPromptMessage[]> {
    const res = (await this.request("prompts/get", { name, arguments: args })) as {
      messages?: McpPromptMessage[];
    };
    return res.messages ?? [];
  }

  stop(): void {
    this.stopped = true;
    this.child?.stdin.end();
    this.child?.kill();
    this.failAll(new Error("[mcp] stopped"));
  }

  private onClose(): void {
    this.failAll(new Error("[mcp] server closed"));
    // ponytail: fixed 500ms backoff, single respawn per close — bump to exponential if a flapping server hot-loops.
    if (this.opts.reconnect && !this.stopped) {
      setTimeout(() => {
        if (!this.stopped) void this.start().catch(() => {});
      }, 500).unref();
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const child = this.child;
    if (!child) return Promise.reject(new Error("[mcp] not started"));
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private notify(method: string, params: unknown): void {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line) as RpcMessage;
      } catch {
        continue; // ignore non-JSON noise (e.g. server logging to stdout)
      }
      // Server-initiated message: a request (id+method) or a notification (method only).
      if (msg.method) {
        if (typeof msg.id === "number" && msg.method === "sampling/createMessage" && this.opts.sampler) {
          void this.handleSampling(msg.id, msg.params);
        }
        continue; // other server requests/notifications are ignored (no capability advertised)
      }
      const p = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
      if (!p || typeof msg.id !== "number") continue; // a reply to an unknown id
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`[mcp] ${msg.error.message}`));
      else p.resolve(msg.result);
    }
  }

  /** Reply to a server's `sampling/createMessage` by running our LLM via the injected sampler. */
  private async handleSampling(id: number, params: unknown): Promise<void> {
    let response: Record<string, unknown>;
    try {
      response = { jsonrpc: "2.0", id, result: await this.opts.sampler!(params) };
    } catch (e) {
      response = { jsonrpc: "2.0", id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } };
    }
    if (this.stopped || !this.child?.stdin.writable) return; // server closed mid-sampling → drop, never crash
    try {
      this.child.stdin.write(`${JSON.stringify(response)}\n`);
    } catch {
      /* stdin closed between the check and the write */
    }
  }

  private failAll(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }
}

/** List an MCP server's tools and register each into the unified registry under `serverId__name`,
 * then broadcast `tool:sync` so listeners (Phase 14 socket) refresh their inventory. */
export async function registerMcpTools(
  registry: ToolRegistry,
  client: McpClient,
  serverId: string,
  bus?: EventBus,
): Promise<string[]> {
  const tools = await client.listTools();
  const names: string[] = [];
  for (const t of tools) {
    const name = `${serverId}__${t.name}`;
    registry.register({
      name,
      description: t.description ?? `MCP tool ${t.name} from ${serverId}`,
      parameters: t.inputSchema ?? { type: "object", properties: {} },
      run: (args) => client.callTool(t.name, args),
    });
    names.push(name);
  }
  bus?.publish({ domain: "tool", type: "sync", payload: { server: serverId, tools: names } });
  return names;
}
