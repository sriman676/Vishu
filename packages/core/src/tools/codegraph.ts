import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface CodeIndex {
  root: string;
  /** symbol name -> files that define it */
  symbols: Map<string, string[]>;
  files: string[];
}

const SKIP = new Set(["node_modules", ".git", "dist", ".vishu", "build", "target"]);
const SYMBOL_RE =
  /\b(?:function|class|interface|type|def|struct|enum)\s+([A-Za-z_]\w*)|\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=/g;

/** Minimal codegraph: walk the tree, index defined symbols so the agent retrieves files
 * instead of dumping the repo. ponytail: regex symbols, not a real parser — upgrade to
 * tree-sitter if cross-language precision is needed. */
export function buildIndex(root: string): CodeIndex {
  const symbols = new Map<string, string[]>();
  const files: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (statSync(full).size < 512_000) {
        const rel = relative(root, full);
        files.push(rel);
        let m: RegExpExecArray | null;
        const text = readFileSync(full, "utf8");
        SYMBOL_RE.lastIndex = 0;
        while ((m = SYMBOL_RE.exec(text))) {
          const name = m[1] ?? m[2];
          if (!name) continue;
          (symbols.get(name) ?? symbols.set(name, []).get(name)!).push(rel);
        }
      }
    }
  };
  walk(root);
  return { root, symbols, files };
}

/** Retrieve files relevant to a query by symbol or path substring. */
export function search(index: CodeIndex, query: string): string[] {
  const q = query.toLowerCase();
  const hits = new Set<string>();
  for (const [name, files] of index.symbols) {
    if (name.toLowerCase().includes(q)) files.forEach((f) => hits.add(f));
  }
  index.files.filter((f) => f.toLowerCase().includes(q)).forEach((f) => hits.add(f));
  return [...hits].slice(0, 50);
}
