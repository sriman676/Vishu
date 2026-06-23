import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../skills/parse.js";

/** One memory note = one markdown file (the Obsidian-editable source of truth). */
export interface Note {
  name: string; // slug == filename (minus .md) == note id
  type: string; // fact | entity | project | task | person | note
  subject?: string; // contradiction key: a newer note with the same subject supersedes this one
  created: string; // ISO
  updated: string; // ISO
  supersededBy?: string; // slug of the note that replaced this one
  body: string; // free text; may contain [[wikilinks]]
  links: string[]; // resolved target slugs extracted from the body
}

/** Stable, filename-safe id from arbitrary text. */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "note"
  );
}

/** `[[Target Name]]` → slug; the wikilink graph the agent walks during recall. */
export function extractLinks(body: string): string[] {
  const links = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) if (m[1]) links.add(slugify(m[1]));
  return [...links];
}

function serialize(note: Note): string {
  const fm: string[] = [
    `id: ${note.name}`,
    `type: ${note.type}`,
    ...(note.subject ? [`subject: ${note.subject}`] : []),
    `created: ${note.created}`,
    `updated: ${note.updated}`,
    ...(note.supersededBy ? [`superseded_by: ${note.supersededBy}`] : []),
  ];
  return `---\n${fm.join("\n")}\n---\n${note.body.replace(/\s*$/, "")}\n`;
}

export function parseNote(name: string, text: string): Note {
  const { meta, body } = parseFrontmatter(text);
  return {
    name,
    type: meta.type || "note",
    subject: meta.subject || undefined,
    created: meta.created || "",
    updated: meta.updated || meta.created || "",
    supersededBy: meta.superseded_by || undefined,
    body,
    links: extractLinks(body),
  };
}

/** Plaintext markdown vault. All writes are atomic (temp file + rename) so a crash never leaves a
 * half-written note. The vault sits outside action_dir, so the agent's write_file tool can't reach
 * it — only the memory subsystem writes here. */
export class Vault {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(name: string): string {
    return join(this.dir, `${name}.md`);
  }

  has(name: string): boolean {
    return existsSync(this.file(name));
  }

  read(name: string): Note | undefined {
    const path = this.file(name);
    return existsSync(path) ? parseNote(name, readFileSync(path, "utf8")) : undefined;
  }

  write(note: Note): void {
    const final = this.file(note.name);
    const tmp = `${final}.tmp`;
    writeFileSync(tmp, serialize(note));
    renameSync(tmp, final); // atomic on the same volume
  }

  remove(name: string): void {
    rmSync(this.file(name), { force: true });
  }

  /** Every note on disk — the rebuild source when the SQLite index is deleted. */
  list(): Note[] {
    if (!existsSync(this.dir)) return [];
    const notes: Note[] = [];
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const name = entry.name.replace(/\.md$/i, "");
        notes.push(parseNote(name, readFileSync(join(this.dir, entry.name), "utf8")));
      }
    }
    return notes;
  }
}
