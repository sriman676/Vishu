import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { processDaily } from "./daily.js";
import { fetchPop3 } from "./gmail.js";
import type { InboundDeps } from "./triage.js";
import type { InboundMessage } from "./types.js";

/** One new inbound item a source discovered, in the canonical triage envelope (id required for dedup). */
export type SyncItem = InboundMessage & { id: string };

/** A pollable connector. `poll` is a pure fetch given the already-seen ids — the loop owns scheduling,
 * dedup persistence, and triage, so a source stays tiny and unit-testable. */
export interface PollSource {
  name: string; // lowercase; drives the env toggle (VISHU_SYNC_<NAME>) + seen-file name
  /** Off unless this returns true. Default: on unless VISHU_SYNC_<NAME>=off (see sourceEnabled). */
  enabled?(env: NodeJS.ProcessEnv): boolean;
  poll(seen: Set<string>): Promise<SyncItem[]>;
}

function loadSeen(file: string): Set<string> {
  try {
    return new Set(readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean));
  } catch {
    return new Set();
  }
}
function saveSeen(file: string, seen: Set<string>): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, [...seen].slice(-500).join("\n")); // keep the tail bounded
  } catch {
    /* best-effort: a persist failure just re-triages an item next restart, never loses one */
  }
}

/** A source is on unless `VISHU_SYNC_<NAME>=off` — opt-out, so a newly registered connector runs by default. */
export function sourceEnabled(name: string, env = process.env): boolean {
  return (env[`VISHU_SYNC_${name.toUpperCase()}`] ?? "on").toLowerCase() !== "off";
}

/** Poll interval: per-source `VISHU_SYNC_<NAME>_MS`, else global `VISHU_SYNC_MS`, else 120s. */
export function sourceInterval(name: string, env = process.env): number {
  return Number(env[`VISHU_SYNC_${name.toUpperCase()}_MS`]) || Number(env.VISHU_SYNC_MS) || 120_000;
}

/** Start the multi-connector auto-fetch loop: each enabled source polls on its own interval and files
 * new items through the daily-driver (triage → matter-match → to-do → draft), exactly like the old
 * single mail poll. Seen ids persist per source so a restart never reprocesses. Returns a stop fn. */
export function startSync(
  deps: InboundDeps,
  sources: PollSource[],
  opts: { seenDir: string; env?: NodeJS.ProcessEnv; file?: (deps: InboundDeps, item: SyncItem) => Promise<unknown> },
): () => void {
  const env = opts.env ?? process.env;
  const file = opts.file ?? processDaily; // seam: tests inject a spy; production files through triage
  const stops: (() => void)[] = [];
  for (const src of sources) {
    const on = src.enabled ? src.enabled(env) : sourceEnabled(src.name, env);
    if (!on) continue;
    const seenFile = join(opts.seenDir, `${src.name}-seen.txt`);
    const seen = loadSeen(seenFile);
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const items = await src.poll(seen);
        for (const it of items) {
          seen.add(it.id);
          await file(deps, it);
        }
        if (items.length) saveSeen(seenFile, seen);
      } catch (e) {
        deps.bus.publish({ domain: "system", type: "notification", payload: { kind: "sync_error", source: src.name, error: e instanceof Error ? e.message : String(e) } });
      }
    };
    const timer = setInterval(() => void tick(), sourceInterval(src.name, env));
    timer.unref?.();
    void tick();
    stops.push(() => {
      stopped = true;
      clearInterval(timer);
    });
  }
  return () => stops.forEach((s) => s());
}

/** Gmail POP3 as a poll source. Auto-disabled (and a no-op) unless GMAIL_USER + GMAIL_APP_PASSWORD are set. */
export function gmailSource(env = process.env): PollSource {
  return {
    name: "gmail",
    enabled: (e) => sourceEnabled("gmail", e) && Boolean(e.GMAIL_USER && e.GMAIL_APP_PASSWORD),
    poll: async (seen) => {
      const user = env.GMAIL_USER;
      const pass = env.GMAIL_APP_PASSWORD;
      if (!user || !pass) return [];
      const mail = await fetchPop3(user, pass, seen, 10);
      return mail.map((m) => ({ channel: "email", from: m.from, text: `${m.subject}\n\n${m.text}`, id: m.uid }));
    },
  };
}

/** A watched folder as a poll source: each new file dropped in VISHU_SYNC_FOLDER is filed through triage
 * (filename = id). Dependency-free local inbox — proves N>1 connectors without any OAuth. */
export function folderSource(env = process.env): PollSource {
  return {
    name: "folder",
    enabled: (e) => sourceEnabled("folder", e) && Boolean(e.VISHU_SYNC_FOLDER),
    poll: async (seen) => {
      const dir = env.VISHU_SYNC_FOLDER;
      if (!dir) return [];
      const out: SyncItem[] = [];
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (seen.has(name) || !statSync(full).isFile()) continue;
        out.push({ channel: "file", from: name, text: readFileSync(full, "utf8").slice(0, 20_000), id: name });
      }
      return out;
    },
  };
}
