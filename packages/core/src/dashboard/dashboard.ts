import { readdirSync, readFileSync, statSync, watch } from "node:fs";
import { basename, join } from "node:path";
import type { VishuPaths } from "../config/paths.js";
import { loadDomains } from "../connectors/domains.js";
import { HARD_BLOCK } from "../modules/fileindex.js";
import { costOf } from "../usage/report.js";

/** §9 "visualize" — a READ-ONLY reader/aggregator over Vishu's existing store + append-only logs.
 * Snapshot-on-poll v1 (no event bus): the frontend polls `vishu.dashboard_snapshot`. Two panels:
 *  1. dataMap  — labelled store locations (paths only, NEVER values; F11 hard-block guarantees no secret).
 *  2. activity — a merged tail of usage.jsonl + decisions.jsonl + memory-events.log. */

export interface DataNode {
  label: string;
  path: string;
  exists: boolean;
  modified: number | null; // mtime ms, null if absent
  holds: string;
}

export interface ActivityEvent {
  ts: number; // ms
  source: "model" | "gate" | "memory";
  text: string;
}

export interface DashboardSnapshot {
  dataMap: DataNode[];
  activity: ActivityEvent[];
}

// Workspace-relative append-only stores. label = filename; second = one-line "holds".
const WORKSPACE_NODES: [rel: string, holds: string][] = [
  ["usage.jsonl", "token + cost ledger (every model call)"],
  ["decisions.jsonl", "gate + egress audit (allow/deny, hash-chained)"],
  ["memory-events.log", "memory writes + run events"],
  ["agents.json", "sub-agent definitions"],
  ["modes.json", "mode definitions"],
  ["triggers.json", "scheduled triggers"],
  ["spans.jsonl", "latency traces"],
];

function node(label: string, path: string, holds: string): DataNode | null {
  if (HARD_BLOCK.test(basename(path))) return null; // F11: never surface a secret path
  let modified: number | null = null;
  let exists = false;
  try {
    modified = statSync(path).mtimeMs;
    exists = true;
  } catch {
    // absent → still listed as a known location, just not-yet-created
  }
  return { label, path, exists, modified, holds };
}

const defaultDomainsFile = (): string =>
  process.env.VISHU_DOMAINS_FILE || join(process.cwd(), "jarvis.domains.json");

// Vault mode/folder partitions: one node per subfolder (e.g. modes/interview), with its direct note count.
function vaultPartitions(vaultDir: string): DataNode[] {
  const out: DataNode[] = [];
  const walk = (rel: string) => {
    let entries;
    try {
      entries = readdirSync(join(vaultDir, rel), { withFileTypes: true });
    } catch {
      return; // vault (or subdir) not created yet
    }
    if (rel) {
      const notes = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).length;
      const n = node(`vault/${rel.replace(/\\/g, "/")}`, join(vaultDir, rel), `${notes} note${notes === 1 ? "" : "s"}`);
      if (n) out.push(n);
    }
    for (const e of entries) if (e.isDirectory()) walk(rel ? join(rel, e.name) : e.name);
  };
  walk("");
  return out;
}

// jarvis.domains.json + one node per attached MCP domain (env-var NAMES only, never values).
function domainNodes(domainsFile: string): DataNode[] {
  const domains = loadDomains(domainsFile);
  const out: DataNode[] = [];
  const file = node("jarvis.domains.json", domainsFile, `${domains.length} attached MCP domain${domains.length === 1 ? "" : "s"}`);
  if (file) out.push(file);
  for (const d of domains) {
    const gated = d.requireEnv ? ` (gated on ${d.requireEnv})` : "";
    const n = node(`domain: ${d.id}`, d.cwd || domainsFile, `MCP via ${d.cmd}${gated}`);
    if (n) out.push(n);
  }
  return out;
}

export function dataMap(paths: VishuPaths, domainsFile = defaultDomainsFile()): DataNode[] {
  const nodes = [
    node("Memory vault", paths.vaultDir, "plaintext Obsidian memory (source of truth)"),
    node("Memory DB", paths.memoryDbFile, "SQLite recall index (rebuildable)"),
    node("Config", paths.configFile, "user config: paths, provider"),
    node("Skills", paths.skillsDir, "installed skills"),
    node("Projects", paths.actionDir, "agent-writable project workspace"),
    ...WORKSPACE_NODES.map(([rel, holds]) => node(rel, join(paths.workspaceDir, rel), holds)),
  ].filter((n): n is DataNode => n !== null);
  return [...nodes, ...vaultPartitions(paths.vaultDir), ...domainNodes(domainsFile)];
}

// ponytail: whole-file read + slice(-n), matching readUsage/readLedger. Add tail-seek if logs grow big.
function tail(file: string, n: number): Record<string, unknown>[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split("\n").slice(-n)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // skip a half-written / corrupt line
    }
  }
  return out;
}

const toMs = (ts: unknown): number => (typeof ts === "number" ? ts : Date.parse(String(ts)) || 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

export function activity(workspaceDir: string, n = 40): ActivityEvent[] {
  const ev: ActivityEvent[] = [];

  for (const r of tail(join(workspaceDir, "usage.jsonl"), n)) {
    const tokens = num(r.promptTokens) + num(r.completionTokens);
    const usd = costOf(r as never);
    const cost = usd > 0 ? ` · $${usd.toFixed(usd < 1 ? 4 : 2)}` : "";
    ev.push({ ts: toMs(r.ts), source: "model", text: `${str(r.model)} · ${str(r.category)} · ${tokens} tok${cost}` });
  }

  for (const r of tail(join(workspaceDir, "decisions.jsonl"), n)) {
    const detail = r.action ? ` ${str(r.action)}` : r.host ? ` → ${str(r.host)}` : "";
    ev.push({ ts: toMs(r.ts), source: "gate", text: `${str(r.kind)} ${str(r.verdict)}: ${str(r.tool)}${detail}` });
  }

  for (const r of tail(join(workspaceDir, "memory-events.log"), n)) {
    ev.push({ ts: toMs(r.ts), source: "memory", text: `${str(r.kind)}: ${str(r.detail)}` });
  }

  return ev.sort((a, b) => b.ts - a.ts).slice(0, n);
}

export function snapshot(paths: VishuPaths, n = 40, domainsFile = defaultDomainsFile()): DashboardSnapshot {
  return { dataMap: dataMap(paths, domainsFile), activity: activity(paths.workspaceDir, n) };
}

const ACTIVITY_FILES = new Set(["usage.jsonl", "decisions.jsonl", "memory-events.log"]);

/** Push side of §9 (live, not just poll): fire `onChange` (debounced) when an activity log under
 * workspaceDir changes, so the UI can refresh immediately. Best-effort — if `fs.watch` throws (some
 * network FS), the frontend poll still covers it. ponytail: 300ms debounce, whole-snapshot refresh (no
 * per-file granularity); switch to a diff feed only if the snapshot ever gets expensive. */
export function watchActivity(workspaceDir: string, onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const w = watch(workspaceDir, (_event, file) => {
      if (file && ACTIVITY_FILES.has(file.toString())) {
        clearTimeout(timer);
        timer = setTimeout(onChange, 300);
      }
    });
    return () => {
      clearTimeout(timer);
      w.close();
    };
  } catch {
    return () => {}; // watch unsupported → poll-only, still correct
  }
}
