import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Cold-apply pipeline: resume self-scoring via the local hiring-agent evaluator (a resume-to-SCORE tool,
 * not a generator). Shells `resume_audit_cli.py <path> [model]` in the hiring-agent repo and parses its
 * JSON evaluation into a compact score + the areas-to-improve that drive the S1→score→improve loop.
 * ponytail: passthrough to the existing CLI (like web_reach) — never re-implements the evaluator; degrades
 * to a clear string when the repo/python/LLM-env isn't ready. */

const pexec = promisify(execFile);

export interface AuditResult {
  ok: boolean;
  summary: string;
  total?: number;
  areasForImprovement?: string[];
  error?: string;
}

const CATEGORIES = ["open_source", "self_projects", "production", "technical_skills"] as const;

function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Parse resume_audit_cli.py stdout (one JSON object: EvaluationData.model_dump() on success, or {error}).
 * Tolerant — non-JSON/empty → an error result, never throws. */
export function parseAudit(stdout: string): AuditResult {
  const trimmed = stdout.trim();
  if (!trimmed) return { ok: false, summary: "resume_audit produced no output", error: "empty" };
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, summary: "resume_audit output was not JSON", error: "bad_json" };
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { ok: false, summary: "resume_audit output was not JSON", error: "bad_json" };
  }
  if (j.error) return { ok: false, summary: `resume_audit error: ${String(j.error)}`, error: String(j.error) };

  const scores = (j.scores ?? {}) as Record<string, { score?: unknown; max?: unknown }>;
  const earned = CATEGORIES.reduce((sum, k) => sum + n(scores[k]?.score), 0);
  const max = CATEGORIES.reduce((sum, k) => sum + n(scores[k]?.max), 0);
  const bonus = n((j.bonus_points as { total?: unknown })?.total);
  const ded = n((j.deductions as { total?: unknown })?.total);
  const total = earned + bonus - ded;
  const strengths = Array.isArray(j.key_strengths) ? j.key_strengths.map(String) : [];
  const areas = Array.isArray(j.areas_for_improvement) ? j.areas_for_improvement.map(String) : [];
  const summary = [
    `score: ${total.toFixed(1)} (categories ${earned}/${max}, +${bonus} bonus, -${ded} deductions)`,
    strengths.length ? `strengths: ${strengths.join("; ")}` : "",
    areas.length ? `improve: ${areas.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { ok: true, summary, total, areasForImprovement: areas };
}

export interface ScoreOpts {
  hiringDir?: string;
  python?: string;
  resumePath?: string;
  resumeMarkdown?: string;
  model?: string;
}

/** Run the hiring-agent scorer and return its parsed summary. Never throws — degrades to a clear message
 * when the repo/script/python isn't available or the subprocess fails. */
export async function scoreResume(opts: ScoreOpts): Promise<string> {
  const dir = opts.hiringDir;
  if (!dir || !existsSync(join(dir, "resume_audit_cli.py")))
    return "resume scoring unavailable — set VISHU_HIRING_AGENT_DIR to the hiring-agent repo (the one with resume_audit_cli.py)";

  let path = opts.resumePath;
  if (!path && opts.resumeMarkdown) {
    path = join(mkdtempSync(join(tmpdir(), "resume-")), "resume.md");
    writeFileSync(path, opts.resumeMarkdown);
  }
  if (!path) return "resume scoring needs `resumeMarkdown` (e.g. from resume_build) or a `resumePath`";

  const args = ["resume_audit_cli.py", path];
  if (opts.model) args.push(opts.model);
  try {
    const { stdout } = await pexec(opts.python || "py", args, { cwd: dir, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    return parseAudit(stdout).summary;
  } catch (e) {
    // execFile rejects on a non-zero exit, but the CLI still prints its JSON {error} to stdout — parse it.
    const err = e as { stdout?: string; message?: string };
    if (err.stdout && err.stdout.trim()) return parseAudit(err.stdout).summary;
    return `resume scoring failed: ${err.message ?? String(e)}`;
  }
}
