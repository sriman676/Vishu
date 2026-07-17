import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Router } from "../providers/router.js";
import { isJsTs, sqlAstFindings } from "./sqlast.js";

export interface Finding {
  file: string;
  line: number;
  rule: string;
  severity: "block" | "warn";
  message: string;
}

/** Deterministic source rules. `block` findings stop "done"; they reliably catch the planted
 * SQLi + hardcoded-secret the Phase 11 success criterion names. Breadth (authz/RLS, missing input
 * validation that can't be matched without false positives) is the LLM review's job, not these. */
const RULES: { rule: string; severity: "block" | "warn"; re: RegExp; message: string }[] = [
  {
    rule: "hardcoded-secret",
    severity: "block",
    re: /(?:api[_-]?key|secret|passwd|password|access[_-]?key|auth[_-]?token|private[_-]?key)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
    message: "hardcoded credential in source — load from env/keychain instead",
  },
  { rule: "aws-key", severity: "block", re: /AKIA[0-9A-Z]{16}/, message: "AWS access key id committed in source" },
  {
    rule: "sql-injection",
    severity: "block",
    // SQL keyword followed by string concatenation (`" + var`) or interpolation (`${`) — not a `?`/`$1` placeholder.
    re: /\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b[^;'"`]*(?:\$\{|['"]\s*\+\s*[A-Za-z_])/i,
    message: "SQL built by string concatenation/interpolation — use parameterized queries",
  },
  { rule: "eval", severity: "warn", re: /\beval\s*\(/, message: "eval() executes arbitrary code" },
  { rule: "weak-crypto", severity: "warn", re: /\b(?:md5|sha1)\b/i, message: "weak hash — prefer sha256 or better" },
];

/** A quoted value that is an all-lowercase kebab/snake identifier (dictionary words + separators, no
 * mixed case) is a public client-id / slug, not a real credential — real keys/tokens are high-entropy
 * with mixed case or long random runs. Downgrade a `hardcoded-secret` match on such a value to warn.
 * e.g. `API_KEY = 'jobboerse-jobsuche'` (arbeitsagentur's public UI client key). Letters-only on purpose:
 * real keys almost always carry digits or mixed case (`sk-abcdef123456`, `ghp_...`), so those stay block. */
const PUBLIC_ID_VALUE = /['"][a-z]+(?:[-_][a-z]+)+['"]/;

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".vishu", "coverage"]);
const CODE = /\.(?:js|mjs|cjs|ts|jsx|tsx|py|rb|php|go|java|cs|rs|sql|env|json|yml|yaml)$|(?:^|[/\\])\.env/i;

function walk(dir: string, onFile: (path: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".env") {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, onFile);
    } else if (CODE.test(entry.name)) {
      onFile(full);
    }
  }
}

/** Read every scannable source file under `dir` (relative path + text). Shared by the scanner and the
 * spec-verify/LLM-review digests so they all see the same file set. Unreadable/binary files are skipped. */
export function readCode(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  walk(dir, (full) => {
    try {
      out.push({ file: relative(dir, full) || full, text: readFileSync(full, "utf8") });
    } catch {
      // unreadable/binary — skip, never crash the scan
    }
  });
  return out;
}

/** Scan a directory tree for security findings — line-level, deterministic. For JS/TS the `sql-injection`
 * rule is replaced by an AST pass (`sqlAstFindings`) that distinguishes an interpolated value from
 * structural/parameterized assembly (UPGRADES §10); other languages keep the line regex. */
export function scanDir(dir: string): Finding[] {
  const findings: Finding[] = [];
  for (const { file, text } of readCode(dir)) {
    const jsTs = isJsTs(file);
    text.split("\n").forEach((line, i) => {
      for (const r of RULES) {
        // sql-injection: JS/TS is handled by the AST pass below; yaml/json/env are config/data, not
        // executable SQL, so the coarse regex only fires false positives there (e.g. a `${{ }}` action.yml).
        if (r.rule === "sql-injection" && (jsTs || /\.(?:ya?ml|json|env)$/i.test(file))) continue;
        if (!r.re.test(line)) continue;
        // A hardcoded-secret whose value is an all-lowercase kebab/snake id is a public client-id, not
        // a credential — surface it (warn) rather than block. Real secrets keep their block severity.
        const publicId = r.rule === "hardcoded-secret" && PUBLIC_ID_VALUE.test(line);
        findings.push({
          file,
          line: i + 1,
          rule: r.rule,
          severity: publicId ? "warn" : r.severity,
          message: publicId ? `${r.message} [public-looking id — downgraded to warn]` : r.message,
        });
      }
    });
    if (jsTs) findings.push(...sqlAstFindings(file, text));
  }
  return findings;
}

export function hasBlockers(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "block");
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "no findings";
  return findings.map((f) => `[${f.severity}] ${f.file}:${f.line} ${f.rule} — ${f.message}`).join("\n");
}

/** Light LLM OWASP-Top-10 review for breadth the rules can't catch (authz, business logic, etc.).
 * Best-effort and advisory — never the deterministic gate. ponytail: single pass, no chunking
 * beyond a size clip; deepen if a real review misses things. */
export async function llmReview(router: Router, model: string, code: string): Promise<string> {
  const res = await router.chat({
    model,
    messages: [
      { role: "system", content: "You are a security reviewer. List concrete OWASP Top-10 issues in this code, one per line, or reply 'none'." },
      { role: "user", content: code.slice(0, 8000) },
    ],
    category: "appbuilder",
  });
  return res.content.trim();
}
