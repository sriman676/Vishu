import type { ToolRegistry } from "../tools/registry.js";
import type { SkillIndex } from "./index.js";

/** Capability acquisition — the SAFE half of "master of any skill" (CF3 / F-masterclass): given a task,
 * infer the capabilities it needs, audit what the skill index + installed tools already cover, and emit a
 * PLAN for each gap. This module never downloads or runs anything — discovery, security-vetting, and the
 * gated install are the next phase (see GITHUB_CHECKS for the gates that phase must clear).
 * ponytail: deterministic keyword inference, not an LLM extractor — upgrade when the keyword set misses
 * real needs (e.g. "scrape" implies a browser/HTTP capability the words don't name). */

/** Task words that carry no capability signal — dropped before inferring needed capabilities. */
const STOPWORDS = new Set([
  "build", "make", "create", "need", "want", "please", "help", "that", "this", "with", "from", "into",
  "your", "mine", "have", "does", "doesnt", "then", "when", "them", "they", "some", "also", "using",
  "website", "site", "page", "app", "tool", "code", "file", "data", "thing", "stuff", "about", "there",
]);

export interface CapabilityAudit {
  /** Capability terms inferred from the task. */
  needed: string[];
  /** Terms already covered by an indexed skill or an installed tool. */
  present: string[];
  /** Terms covered by neither — these must be acquired before the task can run. */
  missing: string[];
}

/** Security gates that MUST pass before installing a discovered GitHub repo (user-required, 2026-07-11):
 * a repo is inert until every one of these clears AND the human approves (F0 change_setting gate). */
export const GITHUB_CHECKS = [
  "secrets: no hardcoded credentials/keys, and no code that reads YOUR secrets/tokens/env to send out",
  "exfiltration: no unexpected calls-home — flag any network egress to non-obvious hosts",
  "remote-exec: no eval/exec of fetched-at-runtime code, reverse shells, or C2 beacons",
  "shell: no unreviewed shell-out, install hooks, or postinstall scripts that run on install",
  "malware/obfuscation: no packed/obfuscated payloads or known-malware signatures",
  "provenance: license present + repo popularity/age sane (not a freshly-published typosquat)",
];

/** Infer the capabilities a task needs — significant words, stopwords removed, deduped, capped. */
export function neededCapabilities(task: string): string[] {
  const words = (task.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 12);
}

/** Audit a task against what's already available: a capability is PRESENT if the skill index matches it or
 * an installed tool's name/description mentions it; otherwise it is MISSING (a gap to acquire). */
export function auditCapabilities(task: string, index: SkillIndex, toolText: string): CapabilityAudit {
  const needed = neededCapabilities(task);
  const tools = toolText.toLowerCase();
  const present: string[] = [];
  const missing: string[] = [];
  for (const cap of needed) {
    const covered = index.search(cap, 1).length > 0 || tools.includes(cap);
    (covered ? present : missing).push(cap);
  }
  return { needed, present, missing };
}

export interface AcquisitionStep {
  capability: string;
  /** Sources to try, safest first — resolved by the (later) discovery+install phase. */
  plan: string[];
  /** Gates every GitHub-repo install must clear before the human is even asked (user-required). */
  githubChecks: string[];
}

/** One acquisition step per missing capability: try a Markdown skill, then a vetted package, then a
 * security-vetted GitHub repo (gated). Deterministic template — the actual discovery/install is next phase. */
export function planAcquisition(missing: string[]): AcquisitionStep[] {
  return missing.map((capability) => ({
    capability,
    plan: [
      `index a Markdown SKILL.md for "${capability}" (safe: instructions only)`,
      `else install a vetted npm/pip package (lockfile + audit, sandboxed)`,
      `else discover a GitHub repo for "${capability}", run security checks, then gated install`,
    ],
    githubChecks: GITHUB_CHECKS,
  }));
}

/** Human-readable audit + plan for the `capability_audit` tool. */
export function renderAudit(task: string, audit: CapabilityAudit): string {
  const lines = [
    `Task: ${task}`,
    `Needed: ${audit.needed.join(", ") || "(none inferred)"}`,
    `Present: ${audit.present.join(", ") || "none"}`,
    `Missing: ${audit.missing.join(", ") || "none — everything needed is already available"}`,
  ];
  if (audit.missing.length) {
    lines.push("", "Acquisition plan (nothing is downloaded or run until you approve):");
    for (const step of planAcquisition(audit.missing)) {
      lines.push(`- ${step.capability}:`);
      for (const s of step.plan) lines.push(`    ${s}`);
    }
    lines.push("", "GitHub install requires ALL of these to pass, then your y/N:");
    for (const c of GITHUB_CHECKS) lines.push(`  · ${c}`);
  }
  return lines.join("\n");
}

/** Expose the audit as a read-only tool. `toolText` is read live so it reflects every registered tool. */
export function registerAcquireTools(registry: ToolRegistry, index: SkillIndex, toolText: () => string): void {
  registry.register({
    name: "capability_audit",
    meta: { action: "read" },
    description:
      "Before a task, infer the skills/capabilities it needs, audit what's already available (skills + tools), and report the gaps with an acquisition plan. Read-only: never downloads or installs.",
    parameters: { type: "object", properties: { task: { type: "string" } }, required: ["task"] },
    run: async (args) => renderAudit(String(args.task ?? ""), auditCapabilities(String(args.task ?? ""), index, toolText())),
  });
}
