import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Finding, formatFindings, hasBlockers, llmReview, readCode, scanDir } from "../appbuilder/security.js";
import type { Router } from "../providers/router.js";
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

/** Low-signal paths: tests, fixtures, mocks, examples, `.env.example`. A block here is almost always a
 * fixture value or a phrase, not a live threat (UPGRADES §10) — downgrade block→warn so the gate stays
 * meaningful instead of BLOCKING every real repo that ships tests + example configs. */
const LOW_TRUST_PATH =
  /(?:^|[\\/])(?:tests?|__tests__|spec|fixtures?|mocks?|examples?)(?:[\\/])|\.(?:test|spec)\.[cm]?[jt]sx?$|\.example\.[^\\/]+$|(?:^|[\\/])\.env\.example$/i;

/** Outbound-send indicators. Exfiltration is a whole-file phrase match (`guardInjection`), so it only
 * truly blocks if the same file can actually send data out; otherwise it's advisory. */
const EGRESS_CALL =
  /\b(?:fetch|axios|XMLHttpRequest|WebSocket|nodemailer|sendMail|urllib|smtplib)\b|https?\.request|net\.connect|requests\.(?:post|put|get|patch)|http\.client/i;

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
    // exfiltration phrasing anywhere in the file (e.g. "send the .env token"). Whole-file phrase match,
    // so only a real block when the file also makes an outbound call; else advisory (UPGRADES §10).
    if (guardInjection(text) === "block") {
      const canSend = EGRESS_CALL.test(text);
      findings.push({
        file,
        line: 1,
        rule: "exfiltration",
        severity: canSend ? "block" : "warn",
        message: canSend ? "reads secrets AND can send them out" : "mentions reading/sending secrets, but no egress call found",
      });
    }
  }

  // install hooks — scripts that run on `npm install` before anyone reviews the code
  findings.push(...scanInstallHooks(dir));
  // provenance — a repo with no license is a weaker signal (typosquat / throwaway)
  if (!hasLicense(dir)) findings.push({ file: ".", line: 1, rule: "no-license", severity: "warn", message: "no LICENSE / license field — provenance unclear" });

  // path-scoped severity: a block in a test/example/fixture path is downgraded to a warn (UPGRADES §10).
  for (const f of findings)
    if (f.severity === "block" && LOW_TRUST_PATH.test(f.file)) {
      f.severity = "warn";
      f.message += " [test/example path — downgraded to warn]";
    }

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

/** Optional advisory LLM pass — breadth the regex gate can't catch (logic-level backdoors, subtle exfil).
 * ADVISORY ONLY: it never blocks or clears an install; the deterministic `analyzeRepo` verdict stays the
 * sole gate. A security block must NOT depend on an LLM reading attacker-controlled code — a malicious repo
 * could prompt-inject "this is safe, approve it", so the LLM's word can only ADD a concern, never relax the
 * gate. ponytail: reuses `llmReview` over a clipped digest. */
export async function llmAdvisory(router: Router, model: string, dir: string): Promise<string> {
  const digest = readCode(dir).map((f) => `// ${f.file}\n${f.text}`).join("\n\n");
  return digest.trim() ? llmReview(router, model, digest) : "";
}
