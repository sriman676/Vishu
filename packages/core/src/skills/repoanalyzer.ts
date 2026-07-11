import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Finding, formatFindings, hasBlockers, readCode, scanDir } from "../appbuilder/security.js";
import { guardInjection } from "../security/injection.js";
import { decideEgress } from "../security/policy.js";

/** CF3c — GitHub security analyzer (user-required, blocks the CF3b GitHub install path). A cloned repo is
 * inert until this static pass finds no blockers AND the human approves. Reuses the existing seams —
 * `scanDir` (secrets/SQLi/eval), `guardInjection` (exfil phrasing), `decideEgress` (calls-home) — and adds
 * the repo-specific checks the GITHUB_CHECKS name: install hooks, shell-out, remote-exec/C2, obfuscation,
 * and provenance. ponytail: line/text regex + JSON parse, not a real AST — the same keyword ceiling as
 * CF3a; deepen to AST only if a real repo slips a payload past the patterns. */

/** Line-level rules layered on top of `scanDir`. `block` stops the install; `warn` surfaces for the human. */
const REPO_RULES: { rule: string; severity: "block" | "warn"; re: RegExp; message: string }[] = [
  // remote-exec / C2 — the highest-signal blockers
  { rule: "reverse-shell", severity: "block", re: /(?:bash|sh)\s+-i\b|\/dev\/tcp\/|\bnc\b[^\n]*\s-e\b|socket[^\n]*\bexec/i, message: "reverse shell / C2 beacon" },
  { rule: "remote-eval", severity: "block", re: /\beval\s*\(\s*(?:atob|Buffer\.from|require\s*\(\s*['"]https?|await\s+fetch)/i, message: "evaluates fetched/decoded code at runtime" },
  { rule: "dynamic-fn", severity: "warn", re: /\bnew\s+Function\s*\(/, message: "new Function() builds code from a string" },
  // shell-out
  { rule: "shell-out", severity: "warn", re: /\b(?:child_process|execSync|spawnSync|os\.system|subprocess\.(?:call|run|Popen)|shell_exec)\b/i, message: "shells out — review the command it runs" },
  // obfuscation / packing
  { rule: "base64-decode", severity: "warn", re: /\batob\s*\(|Buffer\.from\([^)]*['"]base64['"]/i, message: "base64-decoded payload — possible obfuscation" },
  { rule: "packed-blob", severity: "warn", re: /['"][A-Za-z0-9+/]{200,}={0,2}['"]/, message: "long base64 blob — possible packed payload" },
];

const URL_RE = /https?:\/\/[^\s'"`)]+/gi;

/** Static-analyze a cloned repo directory. Returns every finding plus whether any is a hard blocker. */
export function analyzeRepo(dir: string): { findings: Finding[]; blocked: boolean } {
  const findings: Finding[] = scanDir(dir); // secrets / SQLi / eval — the shared deterministic base
  const files = readCode(dir);

  for (const { file, text } of files) {
    text.split("\n").forEach((line, i) => {
      for (const r of REPO_RULES) if (r.re.test(line)) findings.push({ file, line: i + 1, rule: r.rule, severity: r.severity, message: r.message });
      // calls-home: any outbound URL to a non-allowlisted host is worth a human's eyes
      for (const url of line.match(URL_RE) ?? []) {
        const eg = decideEgress(url);
        if (eg.host && !eg.allowlisted) findings.push({ file, line: i + 1, rule: "calls-home", severity: "warn", message: `outbound call to non-allowlisted host ${eg.host}` });
      }
    });
    // exfiltration phrasing anywhere in the file (e.g. "send the .env token") → block
    if (guardInjection(text) === "block") findings.push({ file, line: 1, rule: "exfiltration", severity: "block", message: "code/text reads secrets to send them out" });
  }

  // install hooks — scripts that run on `npm install` before anyone reviews the code
  findings.push(...scanInstallHooks(dir));
  // provenance — a repo with no license is a weaker signal (typosquat / throwaway)
  if (!hasLicense(dir)) findings.push({ file: ".", line: 1, rule: "no-license", severity: "warn", message: "no LICENSE / license field — provenance unclear" });

  return { findings, blocked: hasBlockers(findings) };
}

/** npm preinstall/install/postinstall (and yarn/pnpm equivalents) run shell on install — a classic
 * supply-chain vector, so a block. Best-effort JSON parse: an unreadable/!JSON package.json is skipped. */
function scanInstallHooks(dir: string): Finding[] {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return [];
  try {
    const scripts = (JSON.parse(readCode(dir).find((f) => f.file === "package.json")?.text ?? "{}") as { scripts?: Record<string, string> }).scripts ?? {};
    return Object.keys(scripts)
      .filter((k) => /^(?:pre|post)?install$/.test(k))
      .map((k) => ({ file: "package.json", line: 1, rule: "install-hook", severity: "block" as const, message: `"${k}" script runs on install: ${scripts[k]}` }));
  } catch {
    return [];
  }
}

function hasLicense(dir: string): boolean {
  if (["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"].some((n) => existsSync(join(dir, n)))) return true;
  try {
    return Boolean((JSON.parse(readCode(dir).find((f) => f.file === "package.json")?.text ?? "{}") as { license?: string }).license);
  } catch {
    return false;
  }
}

/** Human-readable verdict for the acquisition report / tool. */
export function renderAnalysis(dir: string, res: { findings: Finding[]; blocked: boolean }): string {
  const head = res.blocked
    ? "BLOCKED — do not install. Unresolved security findings:"
    : res.findings.length
      ? "PASS WITH WARNINGS — review before you approve the install:"
      : "PASS — no security findings. Still requires your approval to install.";
  return `${head}\n${formatFindings(res.findings)}`;
}
