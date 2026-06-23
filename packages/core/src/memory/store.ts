import { RunLog } from "../reliability/runlog.js";
import { MemoryIndex } from "./index.js";
import { extractLinks, slugify, Vault, type Note } from "./vault.js";

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
  ) {
    this.vault = new Vault(vaultDir);
    this.index = new MemoryIndex(dbFile);
    this.log = new RunLog(eventLogFile);
    // Self-heal: a fresh/blank index next to a populated vault rebuilds itself on open.
    if (this.index.isEmpty() && this.vault.list().length) this.reindex();
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
  put(input: PutInput): Note {
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
  recall(query: string, limit = 5): RecallResult {
    const hits = this.guard(() => this.index.search(query, limit * 2), []);
    const gathered = new Map<string, Recalled>();

    for (const hit of hits) {
      if (hit.superseded) continue;
      const note = this.vault.read(hit.name);
      if (!note || note.supersededBy) continue;
      const score = 0.6 * hit.score + 0.4 * lexicalOverlap(query, `${note.subject ?? ""} ${note.body}`);
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
          score: 0.4 * lexicalOverlap(query, `${neighbor.subject ?? ""} ${neighbor.body}`),
          via: "link",
        });
      }
    }

    const notes = [...gathered.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    const text = notes.map((n) => `## ${n.name} (${n.type})\n${n.body}`).join("\n\n");
    return { notes, text };
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
