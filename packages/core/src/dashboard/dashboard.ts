import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { VishuPaths } from "../config/paths.js";
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

export function dataMap(paths: VishuPaths): DataNode[] {
  const nodes = [
    node("Memory vault", paths.vaultDir, "plaintext Obsidian memory (source of truth)"),
    node("Memory DB", paths.memoryDbFile, "SQLite recall index (rebuildable)"),
    node("Config", paths.configFile, "user config: paths, provider"),
    node("Skills", paths.skillsDir, "installed skills"),
    node("Projects", paths.actionDir, "agent-writable project workspace"),
    ...WORKSPACE_NODES.map(([rel, holds]) => node(rel, join(paths.workspaceDir, rel), holds)),
  ];
  return nodes.filter((n): n is DataNode => n !== null);
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

export function snapshot(paths: VishuPaths, n = 40): DashboardSnapshot {
  return { dataMap: dataMap(paths), activity: activity(paths.workspaceDir, n) };
}
