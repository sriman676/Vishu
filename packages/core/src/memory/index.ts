import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Note } from "./vault.js";

export interface IndexHit {
  name: string;
  type: string;
  subject?: string;
  updated: string;
  superseded: boolean;
  links: string[];
  /** FTS bm25 score, normalized so higher = more relevant. */
  score: number;
}

/** Turn free text into a safe FTS5 MATCH expression (quoted OR-terms; never user-controlled syntax). */
function ftsQuery(text: string): string {
  const terms = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return terms.map((t) => `"${t}"`).join(" OR ");
}

/** Derived, rebuildable recall index: SQLite FTS5 over note bodies + a notes metadata table.
 * Deleting the .db file loses nothing — `rebuild()` repopulates it from the markdown vault.
 * ponytail: FTS5 + lexical only for now; embedding-vector scoring drops in here later (PLAN Phase 7
 * deferred) without changing callers — add a vectors table + blend into IndexHit.score. */
export class MemoryIndex {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes(
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        subject TEXT,
        updated TEXT NOT NULL,
        superseded INTEGER NOT NULL DEFAULT 0,
        links TEXT NOT NULL DEFAULT '[]'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(name UNINDEXED, subject, body);
      CREATE TABLE IF NOT EXISTS vectors(name TEXT PRIMARY KEY, dim INTEGER NOT NULL, vec BLOB NOT NULL);
    `);
  }

  hasVectors(): boolean {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM vectors").get() as { n: number }).n > 0;
  }

  upsertVector(name: string, vec: number[]): void {
    const buf = Buffer.from(new Float32Array(vec).buffer);
    this.db.prepare("INSERT OR REPLACE INTO vectors(name, dim, vec) VALUES(?,?,?)").run(name, vec.length, buf);
  }

  /** Cosine of `query` against every stored vector → name→score in [-1,1].
   * ponytail: linear scan over all vectors — fine for a personal vault; add an ANN index if it grows huge. */
  semanticScores(query: number[]): Map<string, number> {
    const qn = Math.hypot(...query) || 1;
    const rows = this.db.prepare("SELECT name, vec FROM vectors").all() as { name: string; vec: Uint8Array }[];
    const out = new Map<string, number>();
    for (const r of rows) {
      const v = new Float32Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength / 4);
      let dot = 0;
      let vn = 0;
      for (let i = 0; i < v.length && i < query.length; i++) {
        dot += v[i]! * query[i]!;
        vn += v[i]! * v[i]!;
      }
      out.set(r.name, dot / (qn * (Math.sqrt(vn) || 1)));
    }
    return out;
  }

  isEmpty(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number };
    return row.n === 0;
  }

  upsert(note: Note): void {
    this.db.prepare("DELETE FROM notes WHERE name = ?").run(note.name);
    this.db.prepare("DELETE FROM notes_fts WHERE name = ?").run(note.name);
    this.db
      .prepare("INSERT INTO notes(name, type, subject, updated, superseded, links) VALUES(?,?,?,?,?,?)")
      .run(note.name, note.type, note.subject ?? null, note.updated, note.supersededBy ? 1 : 0, JSON.stringify(note.links));
    this.db
      .prepare("INSERT INTO notes_fts(name, subject, body) VALUES(?,?,?)")
      .run(note.name, note.subject ?? "", note.body);
  }

  remove(name: string): void {
    this.db.prepare("DELETE FROM notes WHERE name = ?").run(name);
    this.db.prepare("DELETE FROM notes_fts WHERE name = ?").run(name);
    this.db.prepare("DELETE FROM vectors WHERE name = ?").run(name);
  }

  /** Drop everything and re-derive from the vault — the "delete the index, lose nothing" path.
   * Vectors are dropped too; recall re-embeds lazily (semantic is a best-effort overlay on FTS). */
  rebuild(notes: Note[]): void {
    this.db.exec("DELETE FROM notes; DELETE FROM notes_fts; DELETE FROM vectors;");
    for (const note of notes) this.upsert(note);
  }

  meta(name: string): IndexHit | undefined {
    const row = this.db.prepare("SELECT name, type, subject, updated, superseded, links FROM notes WHERE name = ?").get(name) as
      | { name: string; type: string; subject: string | null; updated: string; superseded: number; links: string }
      | undefined;
    if (!row) return undefined;
    return {
      name: row.name,
      type: row.type,
      subject: row.subject ?? undefined,
      updated: row.updated,
      superseded: row.superseded === 1,
      links: JSON.parse(row.links) as string[],
      score: 0,
    };
  }

  search(query: string, limit = 10): IndexHit[] {
    const match = ftsQuery(query);
    if (!match) return [];
    const rows = this.db
      .prepare(
        `SELECT n.name, n.type, n.subject, n.updated, n.superseded, n.links, bm25(notes_fts) AS rank
         FROM notes_fts f JOIN notes n ON n.name = f.name
         WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, limit) as {
      name: string;
      type: string;
      subject: string | null;
      updated: string;
      superseded: number;
      links: string;
      rank: number;
    }[];
    return rows.map((r) => ({
      name: r.name,
      type: r.type,
      subject: r.subject ?? undefined,
      updated: r.updated,
      superseded: r.superseded === 1,
      links: JSON.parse(r.links) as string[],
      score: 1 / (1 + Math.max(0, r.rank)), // bm25: lower is better → map to (0,1], higher is better
    }));
  }

  close(): void {
    this.db.close();
  }
}
