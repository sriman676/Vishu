import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RunLog } from "../reliability/runlog.js";
import { parseFrontmatter } from "../skills/parse.js";

/** One memory note = one markdown file (the Obsidian-editable source of truth). */
export interface Note {
  name: string; // slug == filename (minus .md) == note id (globally unique across folders)
  type: string; // fact | entity | project | task | person | note
  subject?: string; // contradiction key: a newer note with the same subject supersedes this one
  folder?: string; // physical partition under the vault, "/"-separated (e.g. "core", "modes/interview"); undefined = root
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

/** Normalize a folder to a safe, "/"-separated relative path; reject traversal. undefined = root. */
export function normFolder(folder?: string): string | undefined {
  if (!folder) return undefined;
  const parts = folder
    .split(/[\\/]+/)
    .filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) throw new Error(`unsafe folder: ${folder}`);
  return parts.length ? parts.join("/") : undefined;
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
  // folder is physical (the file's location), not frontmatter — derived from path on read.
  return `---\n${fm.join("\n")}\n---\n${note.body.replace(/\s*$/, "")}\n`;
}

export function parseNote(name: string, text: string, folder?: string): Note {
  const { meta, body } = parseFrontmatter(text);
  return {
    name,
    type: meta.type || "note",
    subject: meta.subject || undefined,
    folder,
    created: meta.created || "",
    updated: meta.updated || meta.created || "",
    supersededBy: meta.superseded_by || undefined,
    body,
    links: extractLinks(body),
  };
}

/** Plaintext markdown vault. All writes are atomic (temp file + rename) so a crash never leaves a
 * half-written note. The vault sits outside action_dir, so the agent's write_file tool can't reach
 * it — only the memory subsystem writes here. Notes may live in one-level subfolders (e.g.
 * `modes/interview/`) for per-mode partitions; names stay globally unique so a note resolves by name
 * regardless of folder. Every disk mutation is appended to the optional audit log. */
export class Vault {
  /** name → path relative to `dir` (e.g. "n.md" or "modes/interview/n.md"). The location index. */
  private readonly paths = new Map<string, string>();

  constructor(
    private readonly dir: string,
    private readonly audit?: RunLog,
  ) {
    mkdirSync(dir, { recursive: true });
    this.scan();
  }

  /** Rebuild the name→path map by walking the vault (roots + subfolders). */
  private scan(): void {
    this.paths.clear();
    const walk = (abs: string, rel: string): void => {
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(abs, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
        else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          const name = entry.name.replace(/\.md$/i, "");
          this.paths.set(name, rel ? `${rel}/${entry.name}` : entry.name);
        }
      }
    };
    walk(this.dir, "");
  }

  /** Absolute path of an existing note, or undefined. */
  private abs(name: string): string | undefined {
    const rel = this.paths.get(name);
    return rel ? join(this.dir, rel) : undefined;
  }

  /** "/"-separated folder a relative path lives in (undefined at root). */
  private folderOf(rel: string): string | undefined {
    const i = rel.lastIndexOf("/");
    if (i < 0) return undefined;
    return rel.slice(0, i);
  }

  has(name: string): boolean {
    const abs = this.abs(name);
    return !!abs && existsSync(abs);
  }

  read(name: string): Note | undefined {
    const rel = this.paths.get(name);
    if (!rel) return undefined;
    const abs = join(this.dir, rel);
    return existsSync(abs) ? parseNote(name, readFileSync(abs, "utf8"), this.folderOf(rel)) : undefined;
  }

  write(note: Note): void {
    const folder = normFolder(note.folder);
    note.folder = folder;
    const rel = folder ? `${folder}/${note.name}.md` : `${note.name}.md`;
    const prev = this.paths.get(note.name);
    const final = join(this.dir, ...rel.split("/"));
    mkdirSync(join(final, ".."), { recursive: true });
    const tmp = `${final}.tmp`;
    writeFileSync(tmp, serialize(note));
    renameSync(tmp, final); // atomic on the same volume
    // If the note moved between folders, drop the stale copy so recall never sees a duplicate.
    if (prev && prev !== rel) rmSync(join(this.dir, ...prev.split("/")), { force: true });
    this.paths.set(note.name, rel);
    this.audit?.log("vault_write", rel);
  }

  remove(name: string): void {
    const rel = this.paths.get(name);
    if (!rel) return;
    rmSync(join(this.dir, ...rel.split("/")), { force: true });
    this.paths.delete(name);
    this.audit?.log("vault_remove", rel);
  }

  /** Every note on disk (all folders) — the rebuild source when the SQLite index is deleted.
   * Re-scans first so notes created/edited directly on disk (e.g. in Obsidian) are picked up. */
  list(): Note[] {
    this.scan();
    const notes: Note[] = [];
    for (const [name, rel] of this.paths) {
      const abs = join(this.dir, rel);
      if (existsSync(abs)) notes.push(parseNote(name, readFileSync(abs, "utf8"), this.folderOf(rel)));
    }
    return notes;
  }
}
