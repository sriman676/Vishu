import type { Embedder } from "../providers/types.js";
import { RunLog } from "../reliability/runlog.js";
import { MemoryIndex } from "./index.js";
import { extractLinks, normFolder, slugify, Vault, type Note } from "./vault.js";

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
  /** Physical partition under the vault (e.g. "core", "modes/interview"); undefined = root. */
  folder?: string;
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
    this.log = new RunLog(eventLogFile);
    this.vault = new Vault(vaultDir, this.log); // vault mutations tee to the audit log
    this.index = new MemoryIndex(dbFile);
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
      folder: input.folder,
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
  async recall(query: string, opts: { limit?: number; folder?: string } = {}): Promise<RecallResult> {
    const limit = opts.limit ?? 5;
    // Mode partition: when a folder is given, gather only that partition ∪ core ∪ root (shared);
    // sibling mode folders are excluded so one mode never recalls another's private notes.
    const scope = normFolder(opts.folder);
    const inScope = (f?: string) => !scope || !f || f === scope || f === "core";
    const hits = this.guard(() => this.index.search(query, limit * 2), []);

    // Semantic overlay: blend cosine into FTS hits and surface vector-only candidates FTS missed.
    const sem = await this.semantic(query, limit * 2);
    const candidates = new Set(hits.map((h) => h.name));
    for (const name of sem.keys()) candidates.add(name);
    const ftsScore = new Map(hits.map((h) => [h.name, h.superseded ? -1 : h.score]));

    const gathered = new Map<string, Recalled>();

    for (const name of candidates) {
      const note = this.vault.read(name);
      if (!note || note.supersededBy || !inScope(note.folder)) continue;
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
        if (!neighbor || neighbor.supersededBy || !inScope(neighbor.folder)) continue;
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

  /** §11f ingest lane: connectors write raw inbound here (folder "ingest", transient 7-day tier). Cheap
   * to add — a matched signal is lifted into working memory via promote(); the rest expire in the sweep. */
  async ingest(content: string, subject?: string): Promise<Note> {
    return this.put({ content, subject, type: "ingest", folder: "ingest" });
  }

  /** Lift a note out of the ingest lane into working memory (root, or a named folder) so the TTL sweep
   * won't expire it. No-op (undefined) if the note is gone. Returns the moved note. */
  promote(name: string, folder?: string): Note | undefined {
    const note = this.vault.read(name);
    if (!note) return undefined;
    const moved: Note = { ...note, folder: normFolder(folder), type: note.type === "ingest" ? "fact" : note.type, updated: new Date().toISOString() };
    this.vault.write(moved); // vault.write moves the file + drops the stale copy
    this.guard(() => this.index.upsert(moved), undefined);
    this.log.log("memory_promote", `${name} → ${moved.folder ?? "(working)"}`);
    return moved;
  }

  /** Board write-back: flip one "- [ ] text"/"- [x] text" line (matched by its text) in a todo note,
   * in place so the note keeps its identity. Returns the updated note, or undefined if the note or the
   * line is gone. ponytail: match by exact line text — the board already has it; no line-index bookkeeping. */
  setTodo(name: string, text: string, done: boolean): Note | undefined {
    const note = this.vault.read(name);
    if (!note) return undefined;
    const want = text.trim();
    let hit = false;
    const body = note.body
      .split("\n")
      .map((l) => {
        const m = /^(\s*-\s*)\[[ xX]\](\s*)(.*)$/.exec(l);
        if (m && m[3]!.trim() === want) {
          hit = true;
          return `${m[1]}[${done ? "x" : " "}]${m[2]}${m[3]}`;
        }
        return l;
      })
      .join("\n");
    if (!hit) return undefined;
    const updated: Note = { ...note, body, links: extractLinks(body), updated: new Date().toISOString() };
    this.vault.write(updated);
    this.guard(() => this.index.upsert(updated), undefined);
    this.log.log("memory_todo_set", `${name}: ${done ? "done" : "todo"} ${want.slice(0, 40)}`);
    return updated;
  }

  /** §11f tiering sweep: expire ingest notes past ingestTtlDays (the raw firehose is transient), and
   * move working notes past archiveDays into the "cold" tier (kept on disk, marked by folder). Rebuilds
   * the index once if anything moved. Returns what expired vs archived. ponytail: age-based tiers; add
   * value/access scoring only if a blunt TTL starts dropping notes that still matter. */
  sweepTiers(opts: { ingestTtlDays?: number; archiveDays?: number; now?: number } = {}): { expired: string[]; archived: string[] } {
    const now = opts.now ?? Date.now();
    const ingestCut = now - (opts.ingestTtlDays ?? 7) * 86_400_000;
    const archiveCut = now - (opts.archiveDays ?? 90) * 86_400_000;
    const expired: string[] = [];
    const archived: string[] = [];
    for (const n of this.vault.list()) {
      if (n.supersededBy) continue;
      const age = Date.parse(n.updated);
      if (n.folder === "ingest") {
        if (age < ingestCut) {
          this.vault.remove(n.name);
          expired.push(n.name);
        }
      } else if (n.folder !== "cold" && age < archiveCut) {
        this.vault.write({ ...n, folder: "cold" }); // demote to cold; folder marks the tier, note kept
        archived.push(n.name);
      }
    }
    if (expired.length || archived.length) {
      this.reindex();
      this.log.log("memory_sweep", `expired ${expired.length}, archived ${archived.length}`);
    }
    return { expired, archived };
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

  /** Live notes whose [[links]] point at a target that resolves to no live note (by name or subject
   * slug) — a dangling reference left by a rename/delete or a typo'd wikilink. */
  brokenLinks(): { note: string; missing: string[] }[] {
    const live = this.notes();
    const targets = new Set<string>();
    for (const n of live) {
      targets.add(n.name);
      if (n.subject) targets.add(slugify(n.subject));
    }
    const out: { note: string; missing: string[] }[] = [];
    for (const n of live) {
      const missing = n.links.filter((t) => !targets.has(t));
      if (missing.length) out.push({ note: n.name, missing });
    }
    return out;
  }

  /** Live notes with no outbound and no inbound links — isolated in the graph, easy to lose. */
  orphans(): string[] {
    const live = this.notes();
    const linkedTo = new Set<string>();
    for (const n of live) for (const t of n.links) linkedTo.add(t);
    return live
      .filter((n) => n.links.length === 0 && !linkedTo.has(n.name) && !(n.subject && linkedTo.has(slugify(n.subject))))
      .map((n) => n.name);
  }

  /** Repair same-subject contradictions: for each subject with multiple live notes, keep the newest
   * (recall already prefers it) and remove the stale duplicates. Opt-in — removing notes is a trust
   * boundary, so `selfHeal` only calls this when explicitly asked. Returns what was kept/removed. */
  resolveConflicts(): { subject: string; kept: string; removed: string[] }[] {
    const out: { subject: string; kept: string; removed: string[] }[] = [];
    for (const { subject } of this.conflicts()) {
      const live = this.notes()
        .filter((n) => n.subject === subject)
        .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
      const [keep, ...stale] = live;
      if (!keep || !stale.length) continue;
      for (const s of stale) this.vault.remove(s.name);
      out.push({ subject, kept: keep.name, removed: stale.map((s) => s.name) });
    }
    if (out.length) this.reindex();
    return out;
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
