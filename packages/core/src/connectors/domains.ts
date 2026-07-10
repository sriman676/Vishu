import { readFileSync } from "node:fs";
import type { ActionClass } from "../security/actions.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { EventBus } from "../transport/events.js";
import { McpClient, type McpSampler, registerMcpTools } from "./mcp.js";

/** One external domain service (e.g. JobAutomation) attached over MCP as a namespaced tool set. */
export interface DomainConfig {
  id: string; // namespace prefix — remote tools register as `${id}__${tool}` (e.g. careerops__discover_jobs)
  cmd: string; // process to spawn (the domain's venv python, node, …)
  args?: string[];
  cwd?: string; // launch dir (the domain repo, so its venv/imports resolve)
  reconnect?: boolean; // respawn on unexpected close (default true)
  /** Per-tool action class for the F0 gate; key "*" is the default for tools not listed. */
  actions?: Record<string, ActionClass>;
}

/** Read `jarvis.domains.json`. Optional: a missing/invalid file means "no domains" (never throws). */
export function loadDomains(file: string): DomainConfig[] {
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { domains?: DomainConfig[] }).domains ?? [];
  } catch {
    // ponytail: absent config is the common case (no domains wired yet) — treat as empty.
    return [];
  }
}

/** Attaches configured domain services as namespaced MCP tool sets on the shared registry, applying
 * each domain's declared action classes so the F0 gate treats a remote `send`/`spend`/`delete` like a
 * local one (asks) and a remote `read` like a read (doesn't). One McpClient per domain; `stop()` tears
 * them all down. The registry, gate, and audit stay authoritative — a domain only contributes tools. */
export class DomainManager {
  private readonly clients: McpClient[] = [];

  constructor(
    private readonly configs: DomainConfig[],
    private readonly registry: ToolRegistry,
    private readonly opts: { bus?: EventBus; sampler?: McpSampler } = {},
  ) {}

  /** Spawn + register every configured domain. Returns the namespaced tool names registered. */
  async start(): Promise<string[]> {
    const all: string[] = [];
    for (const cfg of this.configs) {
      const client = new McpClient(cfg.cmd, cfg.args ?? [], {
        reconnect: cfg.reconnect ?? true,
        sampler: this.opts.sampler,
        cwd: cfg.cwd,
      });
      await client.start();
      this.clients.push(client);
      const acts = cfg.actions;
      const resolve = acts ? (tool: string) => acts[tool] ?? acts["*"] : undefined;
      all.push(...(await registerMcpTools(this.registry, client, cfg.id, this.opts.bus, resolve)));
    }
    return all;
  }

  stop(): void {
    for (const c of this.clients) c.stop();
    this.clients.length = 0;
  }
}
