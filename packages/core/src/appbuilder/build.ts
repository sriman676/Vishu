import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Router } from "../providers/router.js";
import type { RunLog } from "../reliability/runlog.js";
import type { SecurityPolicy } from "../security/policy.js";
import type { ToolRegistry } from "../tools/registry.js";
import { ARCHETYPES } from "../orchestration/archetypes.js";
import { ensureRepo, runSubagent, type ValidationResult } from "../orchestration/subagent.js";
import { maintainabilityGate, type GateResult } from "./gate.js";
import { type Finding, formatFindings, hasBlockers, llmReview, readCode, scanDir } from "./security.js";
import { type AppSpec, specToMarkdown } from "./spec.js";

export interface BuildDeps {
  router: Router;
  model: string;
  /** Action-dir-scoped policy + tool registry the chunk subagents inherit and narrow. */
  policy: SecurityPolicy;
  registry: ToolRegistry;
  /** Git repo under the action dir that worktrees branch from (the build target). */
  repoDir: string;
  runLog?: RunLog;
}

export interface BuildOptions {
  maxChunks?: number;
  /** Bounded security remediation rounds at integration (default 2). */
  maxRemediation?: number;
  /** Per-chunk validation (default: accept — security is gated at integration by `harden`). */
  chunkValidate?: (worktreeDir: string) => Promise<ValidationResult>;
  /** Override the remediation builder (tests inject a fix; production runs a coder subagent). */
  fix?: (worktreeDir: string) => Promise<ValidationResult>;
}

export interface BuildReport {
  ok: boolean;
  spec: AppSpec;
  chunks: { name: string; ok: boolean; final: string }[];
  /** Findings remaining after remediation. `ok` requires no `block`-severity finding here. */
  findings: Finding[];
  remediations: number;
  gate: GateResult;
  /** Advisory OWASP-Top-10 breadth note from the LLM review (authz/business-logic the rules can't catch). */
  review: string;
}

/** Clip the repo/worktree's source into a single bounded digest for grounded LLM judgement. */
function digest(dir: string, maxPerFile = 2000, maxTotal = 8000): string {
  return readCode(dir)
    .map(({ file, text }) => `// ${file}\n${text.slice(0, maxPerFile)}`)
    .join("\n\n")
    .slice(0, maxTotal);
}

/** Grounded per-chunk verification: does the code actually produced satisfy the chunk + spec?
 * The model judges only what the worktree contains (anti-hallucination), replying PASS or FAIL. */
export async function specVerify(
  router: Router,
  model: string,
  spec: AppSpec,
  chunk: string,
  worktreeDir: string,
): Promise<ValidationResult> {
  const res = await router.chat({
    model,
    messages: [
      {
        role: "system",
        content: "Verify the built code satisfies the requested chunk and spec. Judge ONLY what the code actually contains — never assume. Reply 'PASS' or 'FAIL: <reason>'.",
      },
      { role: "user", content: `Chunk: ${chunk}\n\nSpec:\n${specToMarkdown(spec)}\n\nCode produced:\n${digest(worktreeDir) || "(no files)"}` },
    ],
    category: "appbuilder",
  });
  return { ok: /^\s*PASS\b/i.test(res.content), output: res.content.trim().slice(0, 200) };
}

/** Default per-chunk validator: block-on-vuln (security pentest during each chunk) THEN grounded
 * spec verification. A chunk only merges if it is both clean and faithful to the spec. */
export function chunkValidator(deps: BuildDeps, spec: AppSpec, chunk: string): (worktreeDir: string) => Promise<ValidationResult> {
  return async (wt) => {
    const findings = scanDir(wt);
    if (hasBlockers(findings)) return { ok: false, output: `security: ${formatFindings(findings.filter((f) => f.severity === "block"))}` };
    return specVerify(deps.router, deps.model, spec, chunk, wt);
  };
}

/** Spec → list of independent build chunks. Falls back to the spec's pages, then the goal itself. */
async function decompose(router: Router, model: string, spec: AppSpec, max: number): Promise<string[]> {
  const res = await router.chat({
    model,
    messages: [
      { role: "system", content: "Break the app into independent build chunks, one per line, no prose." },
      { role: "user", content: `${specToMarkdown(spec)}\n\nList up to ${max} build chunks.` },
    ],
    category: "appbuilder",
  });
  const chunks = res.content
    .split("\n")
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, max);
  return chunks.length ? chunks : spec.pages.length ? spec.pages : [spec.goal];
}

function chunkPrompt(spec: AppSpec, chunk: string): string {
  return [
    `Build this chunk of the app: ${chunk}`,
    "",
    "Full spec:",
    specToMarkdown(spec),
    "",
    "Write working, modular code. Use parameterized queries, never hardcode secrets (read from env),",
    "and validate all external input. Stay strictly inside the action directory.",
  ].join("\n");
}

/** Scan the integrated repo and run bounded remediation subagents until no blocking finding remains
 * (or the budget is spent). This is the "block on injection/secret before done" gate from Phase 11. */
export async function harden(deps: BuildDeps, opts: BuildOptions = {}): Promise<{ findings: Finding[]; remediations: number }> {
  ensureRepo(deps.repoDir);
  let findings = scanDir(deps.repoDir);
  let remediations = 0;
  const max = opts.maxRemediation ?? 2;
  while (hasBlockers(findings) && remediations < max) {
    remediations++;
    const blocking = findings.filter((f) => f.severity === "block");
    deps.runLog?.log("security_remediate", formatFindings(blocking).slice(0, 200));
    await runSubagent({
      archetype: ARCHETYPES.coder!,
      task: `Fix these blocking security findings without changing behavior:\n${formatFindings(blocking)}`,
      parentContext: "security remediation pass",
      parentPolicy: deps.policy,
      parentRegistry: deps.registry,
      router: deps.router,
      model: deps.model,
      repoDir: deps.repoDir,
      runLog: deps.runLog,
      harvest: true,
      // accept the fix only if the worktree re-scans clean of blockers.
      validate: opts.fix ?? (async (wt) => ({ ok: !hasBlockers(scanDir(wt)), output: "rescan" })),
    });
    findings = scanDir(deps.repoDir);
  }
  return { findings, remediations };
}

/** Render the security/gate outcome as a written pentest report (the "written PENTEST REPORT" the
 * build promises). Findings are grouped by severity so a human reads block-level items first. */
export function pentestReport(report: BuildReport): string {
  const bySev = (sev: Finding["severity"]) => report.findings.filter((f) => f.severity === sev);
  const list = (fs: Finding[]) => (fs.length ? formatFindings(fs) : "- (none)");
  return [
    `# Pentest report: ${report.spec.name}`,
    `\n**Verdict:** ${hasBlockers(report.findings) ? "BLOCKED (unresolved block-severity findings)" : "PASS"}`,
    `**Security remediation rounds:** ${report.remediations}`,
    `**Maintainability gate:** ${report.gate.ok ? "pass" : report.gate.issues.join("; ")}`,
    `\n## Blocking findings\n${list(bySev("block"))}`,
    `\n## Warnings\n${list(bySev("warn"))}`,
    `\n## OWASP Top-10 review (advisory)\n${report.review || "- (none)"}`,
  ].join("\n");
}

/** Write the two build artifacts beside the built app so the design + security posture are durable
 * files, not just a vault note + stdout: ARCHITECTURE.md (the spec) and PENTEST.md (the report). */
export function writeBuildArtifacts(repoDir: string, report: BuildReport): { architecture: string; pentest: string } {
  const architecture = join(repoDir, "ARCHITECTURE.md");
  const pentest = join(repoDir, "PENTEST.md");
  writeFileSync(architecture, `${specToMarkdown(report.spec)}\n`);
  writeFileSync(pentest, `${pentestReport(report)}\n`);
  return { architecture, pentest };
}

/** Phase 11 build: decompose the verified spec into chunks, build each as a coder subagent in an
 * isolated worktree (merged on success), then harden (security) + gate (maintainability) before done. */
export async function buildApp(deps: BuildDeps, spec: AppSpec, opts: BuildOptions = {}): Promise<BuildReport> {
  ensureRepo(deps.repoDir);
  const chunks = await decompose(deps.router, deps.model, spec, opts.maxChunks ?? 5);
  const built: BuildReport["chunks"] = [];
  for (const chunk of chunks) {
    deps.runLog?.log("build_chunk", chunk);
    const outcome = await runSubagent({
      archetype: ARCHETYPES.coder!,
      task: chunkPrompt(spec, chunk),
      parentContext: specToMarkdown(spec),
      parentPolicy: deps.policy,
      parentRegistry: deps.registry,
      router: deps.router,
      model: deps.model,
      repoDir: deps.repoDir,
      runLog: deps.runLog,
      harvest: true,
      validate: opts.chunkValidate ?? chunkValidator(deps, spec, chunk),
    });
    built.push({ name: chunk, ok: outcome.ok, final: outcome.final });
  }

  const { findings, remediations } = await harden(deps, opts);
  const gate = maintainabilityGate(deps.repoDir);
  const review = await llmReview(deps.router, deps.model, digest(deps.repoDir));
  const ok = built.every((b) => b.ok) && !hasBlockers(findings) && gate.ok;
  return { ok, spec, chunks: built, findings, remediations, gate, review };
}
