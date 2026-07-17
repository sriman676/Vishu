import { readFileSync } from "node:fs";
import type { ActionClass } from "../security/actions.js";
import { registerEgressHosts } from "../security/policy.js";
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
  /** Hosts this domain is expected to reach (UPGRADES §2d) — folded into the egress allowlist at start. */
  egressHosts?: string[];
  /** Env var that must be set for this domain to attach (e.g. COMPOSIO_API_KEY). Unset ⇒ the domain is
   * inert: not spawned at all. Lets a stub entry ship in jarvis.domains.json without auto-running. */
  requireEnv?: string;
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

  /** Spawn + register every configured domain. Returns the namespaced tool names registered. A domain
   * that fails to spawn/initialize (unconfigured stub, missing binary, bad key) is skipped with a stderr
   * note — one broken/optional domain never aborts the rest or crashes serve. ponytail: per-domain
   * try/catch, no retry ladder; a domain that matters is caught at config review, not by re-spawning. */
  async start(): Promise<string[]> {
    const all: string[] = [];
    for (const cfg of this.configs) {
      if (cfg.requireEnv && !process.env[cfg.requireEnv]) continue; // inert stub — its key isn't set yet
      const client = new McpClient(cfg.cmd, cfg.args ?? [], {
        reconnect: cfg.reconnect ?? true,
        sampler: this.opts.sampler,
        cwd: cfg.cwd,
      });
      try {
        if (cfg.egressHosts?.length) registerEgressHosts(cfg.egressHosts); // §2d: domain declares its own hosts
        await client.start();
        this.clients.push(client);
        const acts = cfg.actions;
        const resolve = acts ? (tool: string) => acts[tool] ?? acts["*"] : undefined;
        all.push(...(await registerMcpTools(this.registry, client, cfg.id, this.opts.bus, resolve)));
      } catch (e) {
        client.stop();
        process.stderr.write(`[domains] ${cfg.id} skipped: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }
    return all;
  }

  stop(): void {
    for (const c of this.clients) c.stop();
    this.clients.length = 0;
  }
}
