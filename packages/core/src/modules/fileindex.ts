import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import type { VishuModule } from "./registry.js";

/** F-PA-FILES — local-file RAG skeleton (flag: `files`). Indexes the user's OWN text files into a local
 * SQLite FTS5 table so the agent can quote them, WITHOUT ever surfacing secrets: the F11 hard-block globs
 * (.env, credentials, tokens, keys, cookies) are refused at index time, and noise dirs (node_modules,
 * caches, OS/program dirs) are skipped. Fully local — no cloud embedder (that would leak). ponytail: FTS5
 * only for now; local `nomic-embed` vectors drop in beside it once Phase 1.5 lands (same MemoryIndex
 * pattern), no caller change. Roots come from VISHU_FILE_ROOTS (';'-separated) or default to cwd. */

// F11 hard-block: never index a file whose name matches these — secrets must not enter any prompt.
const HARD_BLOCK = /(^\.env)|(^\.git$)|credential|secret|(^|[._-])token|id_rsa|id_ed25519|\.pem$|\.key$|\.pfx$|\.p12$|cookies|\.crt$/i;
// Noise dirs: skip wholesale (huge, uninteresting, or not the user's own content).
const SKIP_DIR = /^(node_modules|\.git|\.venv|venv|__pycache__|dist|build|out|\.next|\.cache|target|AppData|Windows|Program Files.*|\$Recycle\.Bin|System Volume Information)$/i;
const TEXT_EXT = new Set([".md", ".txt", ".ts", ".tsx", ".js", ".jsx", ".py", ".json", ".yaml", ".yml", ".html", ".css", ".csv", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".sh", ".ps1", ".sql", ".toml", ".ini"]);
const MAX_BYTES = 512 * 1024; // skip large files — RAG wants documents, not blobs

export function shouldIndex(name: string, ext: string): boolean {
  return TEXT_EXT.has(ext.toLowerCase()) && !HARD_BLOCK.test(name);
}

/** Walk roots, index eligible files' content into FTS5. Returns count indexed. Bounded by maxFiles so a
 * huge tree can't run away. Errors on a single file/dir are swallowed (skip + continue). */
export function indexRoots(db: DatabaseSync, roots: string[], maxFiles = 5000): number {
  let n = 0;
  const stack = [...roots];
  while (stack.length && n < maxFiles) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (n >= maxFiles) break;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIR.test(entry)) stack.push(full);
        continue;
      }
      const ext = extname(entry);
      if (!shouldIndex(entry, ext) || st.size > MAX_BYTES) continue;
      try {
        const body = readFileSync(full, "utf8");
        db.prepare("INSERT OR REPLACE INTO files_fts(path, body) VALUES(?,?)").run(full, body);
        n++;
      } catch {
        /* unreadable/binary — skip */
      }
    }
  }
  return n;
}

function ftsQuery(text: string): string {
  const terms = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return terms.map((t) => `"${t}"`).join(" OR ");
}

export const fileIndexModule: VishuModule = {
  name: "files",
  setup({ tools, workspaceDir }) {
    const dbPath = join(workspaceDir, "fileindex.db");
    mkdirSync(workspaceDir, { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(path UNINDEXED, body);");
    const roots = () => (process.env.VISHU_FILE_ROOTS?.split(";").map((s) => s.trim()).filter(Boolean) ?? [process.cwd()]);

    tools.register({
      name: "file_index",
      meta: { action: "read" }, // reads the disk into a local index; no outbound, no mutation of user files
      description: "Index your local text files (VISHU_FILE_ROOTS or cwd) for search. Secrets are never indexed.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        try {
          const count = indexRoots(db, roots());
          return `indexed ${count} file(s) from ${roots().join(", ")}`;
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });

    tools.register({
      name: "file_search",
      meta: { action: "read" },
      description: "Search your indexed local files; returns the top matching paths + a snippet.",
      parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
      run: async (a) => {
        const q = ftsQuery(String(a.query ?? ""));
        if (!q) return "error: empty query";
        try {
          const rows = db
            .prepare("SELECT path, snippet(files_fts, 1, '[', ']', '…', 12) AS snip FROM files_fts WHERE files_fts MATCH ? ORDER BY bm25(files_fts) LIMIT ?")
            .all(q, Math.min(Number(a.limit ?? 5), 20)) as { path: string; snip: string }[];
          return rows.length ? rows.map((r) => `${r.path}\n  ${r.snip}`).join("\n") : "no matches";
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });

    tools.register({
      name: "file_context",
      meta: { action: "read" },
      description:
        "RAG-quote your own files: retrieve the top matching passages (wider excerpts than file_search) as grounded context to QUOTE from, each labelled with its source path. Answer the user strictly from these excerpts and cite the path; this keeps private files on the local model instead of guessing.",
      parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
      run: async (a) => retrieveContext(db, String(a.query ?? ""), Math.min(Number(a.limit ?? 4), 12)),
    });
  },
};

/** Retrieve the top-k wider passages for a query, formatted as quotable, path-labelled context — the
 * grounding the (local) model answers from. Pure over the db so it's unit-testable without a live model. */
export function retrieveContext(db: DatabaseSync, query: string, limit = 4): string {
  const q = ftsQuery(query);
  if (!q) return "error: empty query";
  try {
    const rows = db
      .prepare("SELECT path, snippet(files_fts, 1, '', '', ' … ', 64) AS excerpt FROM files_fts WHERE files_fts MATCH ? ORDER BY bm25(files_fts) LIMIT ?")
      .all(q, limit) as { path: string; excerpt: string }[];
    if (!rows.length) return "no matches — nothing in your indexed files covers that.";
    return rows.map((r, i) => `[${i + 1}] ${r.path}\n${r.excerpt.trim()}`).join("\n\n");
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
