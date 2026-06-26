import type { Embedder } from "../providers/types.js";
import { RunLog } from "../reliability/runlog.js";
import { MemoryIndex } from "./index.js";
import { extractLinks, slugify, Vault, type Note } from "./vault.js";

/** Age-based confidence decay: a fact halves its ranking weight every HALFLIFE days, so newer facts
 * win near-ties. ponytail: simple exponential half-life; tune HALFLIFE if recall favours stale notes. */
const DECAY_HALFLIFE_DAYS = 30;
function decay(updated: string): number {
  const ageDays = (Date.now() - Date.parse(updated)) / 86_400_000;
  return Number.isFinite(ageDays) && ageDays > 0 ? 0.5 ** (ageDays / DECAY_HALFLIFE_DAYS) : 1;
}

export interface PutInput {
  content: string;
  type?: string;
  /** Contradiction key: writing a new note with the same subject supersedes the prior one. */
  subject?: string;
}

export interface Recalled {
  name: string;
  type: string;
  body: string;
  score: number;
  via: "match" | "link"; // direct FTS hit vs gathered by walking a [[link]]
}

export interface RecallResult {
  notes: Recalled[];
  /** Ready-to-inject bundle for the model — only the gathered notes, never a vault dump. */
  text: string;
}

function terms(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function lexicalOverlap(query: string, body: string): number {
  const q = terms(query);
  if (!q.length) return 0;
  const hay = new Set(terms(body));
  return q.filter((t) => hay.has(t)).length / q.length;
}

/** Memory subsystem: plaintext vault is the source of truth, SQLite is a rebuildable recall index.
 * The vault always gets written; index writes are guarded by a circuit breaker so an index fault
 * degrades recall but never loses a memory. */
export class MemoryStore {
  private readonly vault: Vault;
  private index: MemoryIndex;
  private readonly log: RunLog;
  private indexFailures = 0;
  private breakerOpen = false;
  private readonly breakerThreshold = 3;

  constructor(
    private readonly vaultDir: string,
    private readonly dbFile: string,
    eventLogFile?: string,
    /** Optional: enables semantic recall. Absent = FTS + lexical + smart-walk only (no regression). */
    private readonly embedder?: Embedder,
  ) {
    this.vault = new Vault(vaultDir);
    this.index = new MemoryIndex(dbFile);
    this.log = new RunLog(eventLogFile);
    // Self-heal: a fresh/blank index next to a populated vault rebuilds itself on open.
    if (this.index.isEmpty() && this.vault.list().length) this.reindex();
  }

  /** Embed a note body and store its vector (guarded; embedding faults degrade recall, never lose data). */
  private async embedNote(note: Note): Promise<void> {
    if (!this.embedder || note.supersededBy) return;
    try {
      const [vec] = await this.embedder([`${note.subject ?? ""} ${note.body}`]);
      if (vec) this.guard(() => this.index.upsertVector(note.name, vec), undefined);
    } catch (e) {
      this.log.log("memory_embed_error", e instanceof Error ? e.message : String(e));
    }
  }

  /** Run an index mutation/read under the breaker; on repeated failure, degrade (vault stays truth). */
  private guard<T>(op: () => T, fallback: T): T {
    if (this.breakerOpen) return fallback;
    try {
      const r = op();
      this.indexFailures = 0;
      return r;
    } catch (e) {
      this.indexFailures++;
      this.log.log("memory_index_error", e instanceof Error ? e.message : String(e));
      if (this.indexFailures >= this.breakerThreshold) {
        this.breakerOpen = true;
        this.log.log("memory_breaker_open", "recall degraded; vault remains source of truth");
      }
      return fallback;
    }
  }

  private uniqueName(base: string): string {
    const slug = slugify(base);
    return this.vault.has(slug) ? `${slug}-${Date.now().toString(36)}` : slug;
  }

  /** Write a memory. If `subject` matches an existing live note, that note is superseded (kept on
   * disk with a pointer, dropped from active recall). ponytail: contradiction = exact subject match;
   * semantic contradiction detection needs a model — add when subject-keying proves too coarse. */
  async put(input: PutInput): Promise<Note> {
    const now = new Date().toISOString();
    const note: Note = {
      name: this.uniqueName(input.subject ?? input.content),
      type: input.type ?? "fact",
      subject: input.subject,
      created: now,
      updated: now,
      body: input.content,
      links: extractLinks(input.content),
    };
    if (input.subject) this.supersedePrior(input.subject, note.name);
    this.vault.write(note);
    this.guard(() => this.index.upsert(note), undefined);
    await this.embedNote(note);
    this.log.log("memory_put", `${note.name} (${note.type})`);
    return note;
  }

  private supersedePrior(subject: string, replacement: string): void {
    for (const note of this.vault.list()) {
      if (note.subject === subject && !note.supersededBy) {
        const superseded: Note = { ...note, supersededBy: replacement, updated: new Date().toISOString() };
        this.vault.write(superseded);
        this.guard(() => this.index.upsert(superseded), undefined);
        this.log.log("memory_supersede", `${note.name} (subject: ${subject})`);
      }
    }
  }

  /** Hybrid recall: FTS/lexical match, then a one-hop smart-walk over [[links]] to gather context.
   * Superseded notes are excluded; newest wins on ties. Returns only the gathered notes, not a dump. */
  async recall(query: string, limit = 5): Promise<RecallResult> {
    const hits = this.guard(() => this.index.search(query, limit * 2), []);

    // Semantic overlay: blend cosine into FTS hits and surface vector-only candidates FTS missed.
    const sem = await this.semantic(query, limit * 2);
    const candidates = new Set(hits.map((h) => h.name));
    for (const name of sem.keys()) candidates.add(name);
    const ftsScore = new Map(hits.map((h) => [h.name, h.superseded ? -1 : h.score]));

    const gathered = new Map<string, Recalled>();

    for (const name of candidates) {
      const note = this.vault.read(name);
      if (!note || note.supersededBy) continue;
      const fts = ftsScore.get(name) ?? 0;
      if (fts < 0) continue; // superseded per the index
      const lex = lexicalOverlap(query, `${note.subject ?? ""} ${note.body}`);
      const cos = Math.max(0, sem.get(name) ?? 0);
      const score = (0.5 * fts + 0.3 * lex + 0.2 * cos) * decay(note.updated);
      gathered.set(note.name, { name: note.name, type: note.type, body: note.body, score, via: "match" });
      // smart-walk: one hop along wikilinks, gather neighbors not already matched.
      for (const target of note.links) {
        if (gathered.has(target)) continue;
        const neighbor = this.vault.read(target);
        if (!neighbor || neighbor.supersededBy) continue;
        gathered.set(neighbor.name, {
          name: neighbor.name,
          type: neighbor.type,
          body: neighbor.body,
          score: 0.4 * lexicalOverlap(query, `${neighbor.subject ?? ""} ${neighbor.body}`) * decay(neighbor.updated),
          via: "link",
        });
      }
    }

    const notes = [...gathered.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    const text = notes.map((n) => `## ${n.name} (${n.type})\n${n.body}`).join("\n\n");
    return { notes, text };
  }

  /** Cosine scores for the query over stored vectors (empty when no embedder / no vectors). */
  private async semantic(query: string, _limit: number): Promise<Map<string, number>> {
    if (!this.embedder || !this.guard(() => this.index.hasVectors(), false)) return new Map();
    try {
      const [vec] = await this.embedder([query]);
      return vec ? this.guard(() => this.index.semanticScores(vec), new Map<string, number>()) : new Map();
    } catch (e) {
      this.log.log("memory_embed_error", e instanceof Error ? e.message : String(e));
      return new Map();
    }
  }

  /** All current (non-superseded) notes — for rollups / inspection. */
  notes(): Note[] {
    return this.vault.list().filter((n) => !n.supersededBy);
  }

  /** Eviction (self-healing memory): drop superseded notes older than the cutoff to bound vault/index
   * growth — the live note that replaced them stays; history beyond the window is forgotten. Rebuilds the
   * index once after pruning. Returns the names removed. ponytail: time-based prune, no value scoring. */
  pruneSuperseded(olderThanDays = 30): string[] {
    const cutoff = Date.now() - olderThanDays * 86_400_000;
    const removed: string[] = [];
    for (const n of this.vault.list()) {
      if (n.supersededBy && Date.parse(n.updated) < cutoff) {
        this.vault.remove(n.name);
        removed.push(n.name);
      }
    }
    if (removed.length) {
      this.reindex();
      this.log.log("memory_prune", `${removed.length} superseded notes evicted`);
    }
    return removed;
  }

  /** Subjects with more than one *live* note — a contradiction the supersede-on-write path missed
   * (e.g. notes edited directly in Obsidian). Recall already prefers newest; this surfaces the conflict. */
  conflicts(): { subject: string; notes: string[] }[] {
    const bySubject = new Map<string, string[]>();
    for (const n of this.notes()) {
      if (!n.subject) continue;
      const names = bySubject.get(n.subject);
      if (names) names.push(n.name);
      else bySubject.set(n.subject, [n.name]);
    }
    return [...bySubject.entries()].filter(([, names]) => names.length > 1).map(([subject, notes]) => ({ subject, notes }));
  }

  /** Re-derive the whole index from the markdown vault (resets the breaker). */
  reindex(): number {
    this.breakerOpen = false;
    this.indexFailures = 0;
    const notes = this.vault.list();
    this.index.rebuild(notes);
    this.log.log("memory_reindex", `${notes.length} notes`);
    return notes.length;
  }

  close(): void {
    this.index.close();
  }
}
