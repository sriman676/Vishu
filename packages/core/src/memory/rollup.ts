import type { Note } from "./vault.js";
import type { MemoryStore } from "./store.js";

export interface RollupOptions {
  /** Only roll up notes updated at/after this epoch-ms (default: all current notes). */
  since?: number;
  /** Rollup note subject (default: session-rollup-<date>). */
  subject?: string;
  /** Optional LLM summariser over the extracted digest; default keeps the digest as-is (extractive). */
  summarize?: (digest: string) => Promise<string>;
}

function firstSentence(body: string, cap = 160): string {
  const s = body.trim().split(/(?<=[.!?])\s/)[0] ?? body.trim();
  return s.length > cap ? `${s.slice(0, cap)}…` : s;
}

/** Memory Tree rollup: condense the vault's current notes into one summary note so next session reads
 * the rollup instead of every note (token-cheap). Extractive by default (one line per note, linked via
 * [[wikilinks]] so the graph stays intact); pass `summarize` to compress further with a model.
 * ponytail: extractive digest, no model required; the `summarize` hook is the upgrade for real prose. */
export async function rollupSession(store: MemoryStore, opts: RollupOptions = {}): Promise<Note> {
  const notes = store
    .notes()
    .filter((n) => n.type !== "rollup" && (opts.since === undefined || Date.parse(n.updated) >= opts.since));
  const digest = notes.map((n) => `- [[${n.name}]] (${n.type}): ${firstSentence(n.body)}`).join("\n");
  const body = opts.summarize ? await opts.summarize(digest) : digest;
  const subject = opts.subject ?? `session-rollup-${new Date().toISOString().slice(0, 10)}`;
  return store.put({ type: "rollup", subject, content: `Session rollup (${notes.length} notes):\n${body}` });
}

export interface SelfHealResult {
  /** Superseded notes evicted to bound growth. */
  pruned: string[];
  /** Subjects that still have more than one live note (recency-weighted recall handles ranking). */
  conflicts: { subject: string; notes: string[] }[];
  /** Notes with [[links]] pointing at a target that no live note satisfies (dangling references). */
  brokenLinks: { note: string; missing: string[] }[];
  /** Notes with no inbound and no outbound links — isolated in the graph. */
  orphans: string[];
}

/** Self-healing memory (Set C #7): consolidate by evicting stale superseded notes (bounds unbounded
 * growth) and report unresolved same-subject contradictions. Recall already applies recency/decay
 * weighting; this is the periodic maintenance + conflict-surfacing pass. Extends the rollup. */
export function selfHealMemory(store: MemoryStore, opts: { olderThanDays?: number } = {}): SelfHealResult {
  return {
    pruned: store.pruneSuperseded(opts.olderThanDays),
    conflicts: store.conflicts(),
    brokenLinks: store.brokenLinks(),
    orphans: store.orphans(),
  };
}
