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

/** Curated MCP servers connectable by name via `vishu connect <name>` — each is a DomainConfig template
 * folded into jarvis.domains.json and mounted (gated) on the next `vishu jarvis`. Anything not listed is
 * still connectable with `vishu connect <id> --cmd <cmd> [--args <json>]`, so the gateway reaches ANY MCP.
 * ponytail: three vetted, correct entries + a generic escape hatch — not a hardcoded catalogue of every app
 * (Composio already fans out to 1000+). New npx package = vet before first enable (user rule). */
export const KNOWN_MCP: Record<string, DomainConfig> = {
  // Microsoft's official Playwright MCP: real browser control (navigate/click/type/submit). A persistent
  // profile lets the user do an OAuth "login once" by hand, then the session is reused. Mutating tools gate
  // (send/change_setting); navigation + snapshots read. VET before first enable.
  browser: {
    id: "browser",
    cmd: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    reconnect: true,
    actions: {
      browser_click: "send",
      browser_type: "send",
      browser_fill_form: "send",
      browser_press_key: "send",
      browser_select_option: "send",
      browser_file_upload: "send",
      browser_drag: "send",
      browser_drop: "send", // drops files/elements onto the page — an outward mutation
      browser_handle_dialog: "send", // can confirm a native dialog (e.g. accept a delete prompt)
      browser_evaluate: "change_setting", // runs arbitrary page JS
      browser_run_code_unsafe: "change_setting", // arbitrary code execution — must never auto-run
      "*": "read", // navigate/snapshot/screenshot/wait/tabs/console/network = read (auto)
    },
  },
  github: {
    id: "github",
    cmd: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    requireEnv: "GITHUB_PERSONAL_ACCESS_TOKEN",
    reconnect: false,
    egressHosts: ["api.github.com"],
  },
  composio: {
    id: "composio",
    cmd: "npx",
    args: ["-y", "@composio/mcp@latest", "start", "--transport", "stdio"],
    requireEnv: "COMPOSIO_API_KEY",
    reconnect: false,
    egressHosts: ["mcp.composio.dev", "backend.composio.dev", "api.composio.dev"],
  },
  // Firecrawl web scraping/crawl MCP. Inert until FIRECRAWL_API_KEY is set (cloud API) — a gated-off
  // stub, same discipline as composio/github. Scrape/crawl tools read; nothing outward.
  firecrawl: {
    id: "firecrawl",
    cmd: "npx",
    args: ["-y", "firecrawl-mcp"],
    requireEnv: "FIRECRAWL_API_KEY",
    reconnect: false,
    egressHosts: ["api.firecrawl.dev"],
  },
  // block/buzz (Apache-2.0): self-hosted Nostr-relay workspace for humans+agents; its `buzz-acp` harness
  // speaks MCP/ACP. buzz is a Rust monorepo (needs `just build`), not an npx package — so this is a gated
  // stub, inert until VISHU_BUZZ_ACP points at the built buzz-acp binary. Then `vishu connect buzz` mounts
  // it. ponytail: env-path cmd, no hardcoded clone dir; confirm buzz-acp's stdio flags before first enable.
  buzz: {
    id: "buzz",
    cmd: process.env.VISHU_BUZZ_ACP ?? "buzz-acp",
    requireEnv: "VISHU_BUZZ_ACP",
    reconnect: false,
    egressHosts: ["localhost", "127.0.0.1"],
  },
};

export type ConnectVia = "known" | "composio";
/** Resolve a bare app name to a mountable domain — this is what makes "connect <app>" work for ANY name.
 * A curated MCP (browser/github/composio/firecrawl) mounts itself; anything else routes through the
 * universal Composio mount (1000+ apps behind one key + one process — no per-app npx package to download,
 * so no spawn lag). `vishu connect <id> --cmd …` (handled by the caller) still mounts any custom MCP. */
export function resolveConnect(name: string): { cfg: DomainConfig; via: ConnectVia } {
  const known = KNOWN_MCP[name];
  if (known) return { cfg: { ...known }, via: "known" };
  return { cfg: { ...KNOWN_MCP.composio! }, via: "composio" }; // composio is a literal in KNOWN_MCP — always defined
}

/** Replace an existing domain with the same id (idempotent connect) or append it. Pure — used by the
 * `vishu connect` command to edit jarvis.domains.json without duplicating entries. */
export function upsertDomain(list: DomainConfig[], cfg: DomainConfig): DomainConfig[] {
  return [...list.filter((d) => d.id !== cfg.id), cfg];
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
