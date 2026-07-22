import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ActionClass } from "../security/actions.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { DomainConfig } from "./domains.js";

const run = promisify(execFile);

/** A plugged-in repo under `integrations/<name>/` described by a `jarvis-adapter.json`. Three kinds, per
 * the F2 contract: an MCP server (reuses DomainManager), a CLI (each declared subcommand is a namespaced
 * tool that runs a NO-SHELL args-array command), or a data source (a read tool that returns a file's text).
 * The adapter file is trusted config; runtime tool input is passed as arguments, never interpolated into a
 * shell string — so a repo's own commands can't be turned into injection by the model's arguments. */
export type RepoAdapter =
  | ({ id: string; kind: "mcp" } & Omit<DomainConfig, "id">)
  | { id: string; kind: "cli"; cmd: string; cwd?: string; tools: CliTool[] }
  | { id: string; kind: "data"; tools: DataTool[] };

export interface CliTool {
  name: string;
  description?: string;
  /** Fixed leading args (the subcommand). Runtime `input` is appended as one more arg when provided. */
  args?: string[];
  /** F0 action class (default read — a CLI query). Set send/write/etc. for a mutating subcommand. */
  action?: ActionClass;
}

export interface DataTool {
  name: string;
  description?: string;
  /** File to read, relative to the adapter dir (or absolute). */
  path: string;
}

/** Discover every `integrations/<name>/jarvis-adapter.json` under `dir`. A missing dir or an unreadable/
 * invalid adapter file is skipped (never throws) — one broken repo can't abort the rest. Each adapter's
 * paths (`cwd`, data `path`) are resolved relative to its own directory so a repo is self-contained. */
export function loadRepoAdapters(dir: string): RepoAdapter[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return []; // no integrations dir yet
  }
  const adapters: RepoAdapter[] = [];
  for (const name of entries) {
    const adapterDir = join(dir, name);
    try {
      const raw = JSON.parse(readFileSync(join(adapterDir, "jarvis-adapter.json"), "utf8")) as RepoAdapter;
      if (!raw?.id || !raw.kind) continue;
      adapters.push(resolvePaths(raw, adapterDir));
    } catch {
      // no adapter file in this repo, or malformed — skip it silently (discovery is best-effort).
    }
  }
  return adapters;
}

/** Resolve an adapter's relative paths against its own dir so it works regardless of the process cwd. */
function resolvePaths(a: RepoAdapter, adapterDir: string): RepoAdapter {
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(adapterDir, p));
  if (a.kind === "mcp") return { ...a, cwd: a.cwd ? abs(a.cwd) : adapterDir };
  if (a.kind === "cli") return { ...a, cwd: a.cwd ? abs(a.cwd) : adapterDir };
  return { ...a, tools: a.tools.map((t) => ({ ...t, path: abs(t.path) })) };
}

/** The MCP-kind adapters as DomainConfigs, so `DomainManager` mounts them exactly like a root-config
 * domain (one McpClient per repo, namespaced tools, per-tool action classes reaching the F0 gate). */
export function toDomainConfigs(adapters: RepoAdapter[]): DomainConfig[] {
  return adapters.filter((a): a is RepoAdapter & { kind: "mcp" } => a.kind === "mcp").map(({ kind: _kind, ...cfg }) => cfg);
}

/** Register the CLI + data adapters as namespaced tools (`${id}__${tool}`). Returns the tool names added.
 * MCP-kind adapters are handled by DomainManager, not here. */
export function registerAdapterTools(registry: ToolRegistry, adapters: RepoAdapter[]): string[] {
  const added: string[] = [];
  for (const a of adapters) {
    if (a.kind === "cli") {
      for (const t of a.tools) added.push(registerCli(registry, a, t));
    } else if (a.kind === "data") {
      for (const t of a.tools) added.push(registerData(registry, a.id, t));
    }
  }
  return added;
}

function registerCli(registry: ToolRegistry, a: RepoAdapter & { kind: "cli" }, t: CliTool): string {
  const name = `${a.id}__${t.name}`;
  registry.register({
    name,
    description: t.description ?? `Run the ${a.id} "${t.name}" command.`,
    meta: { action: t.action ?? "read" },
    parameters: { type: "object", properties: { input: { type: "string", description: "Optional argument appended to the command." } } },
    run: async (args) => {
      const extra = args.input != null && String(args.input) !== "" ? [String(args.input)] : [];
      try {
        // no-shell args-array spawn: the model's `input` is an argv element, never a shell fragment.
        const { stdout, stderr } = await run(a.cmd, [...(t.args ?? []), ...extra], { cwd: a.cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
        return (stdout || stderr || "(no output)").slice(0, 8000);
      } catch (e) {
        return `[${name}] failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });
  return name;
}

function registerData(registry: ToolRegistry, id: string, t: DataTool): string {
  const name = `${id}__${t.name}`;
  registry.register({
    name,
    description: t.description ?? `Read the ${id} "${t.name}" data.`,
    meta: { action: "read" },
    parameters: { type: "object", properties: {} },
    run: async () => {
      try {
        return readFileSync(t.path, "utf8").slice(0, 16_000);
      } catch (e) {
        return `[${name}] unreadable: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });
  return name;
}
