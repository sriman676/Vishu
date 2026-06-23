import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface GateResult {
  ok: boolean;
  issues: string[];
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".vishu", "coverage"]);
const SRC = /\.(?:js|mjs|cjs|ts|jsx|tsx|py|rb|php|go|java|cs|rs)$/i;

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...collect(full));
    } else if (SRC.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Scalability/maintainability gate before "done": flags oversized files, copy-paste duplication,
 * and absent tests. Cheap heuristics, dependency-free. ponytail: line-based dup, fixed LOC ceiling —
 * swap in an AST/complexity metric if these miss real rot. */
export function maintainabilityGate(dir: string): GateResult {
  const issues: string[] = [];
  const files = collect(dir);
  if (files.length === 0) {
    return { ok: false, issues: ["no source files were produced"] };
  }

  let hasTest = false;
  const lineCounts = new Map<string, number>(); // non-trivial line -> occurrences across the tree
  for (const f of files) {
    if (/\.(?:test|spec)\.|_test\.|(?:^|[/\\])tests?[/\\]/i.test(f)) hasTest = true;
    const text = readFileSync(f, "utf8");
    const lines = text.split("\n");
    if (lines.length > 400) issues.push(`${relative(dir, f)}: ${lines.length} LOC — split this oversized file`);
    for (const raw of lines) {
      const line = raw.trim();
      if (line.length >= 40) lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
    }
  }

  const dups = [...lineCounts.entries()].filter(([, n]) => n >= 4);
  if (dups.length > 0) issues.push(`${dups.length} substantial line(s) duplicated 4+ times — extract shared code`);
  if (!hasTest) issues.push("no tests found — add coverage before done (beat the 80/20 wall)");

  return { ok: issues.length === 0, issues };
}
