import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The fields of a SWE-bench instance we need to generate a patch. The official scorer holds the rest
 * (test patch, FAIL_TO_PASS / PASS_TO_PASS) — we never see them, which is the point: the agent fixes the
 * issue blind, exactly as a developer would. */
export interface SweInstance {
  instance_id: string;
  repo: string; // "owner/name"
  base_commit: string;
  problem_statement: string;
}

/** One line of the predictions file the official harness reads (`run_evaluation --predictions_path`). */
export interface SwePrediction {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
}

const HF_ROWS = "https://datasets-server.huggingface.co/rows";

/** Pull just the four fields the harness needs out of raw dataset rows. */
export function normalizeRows(rows: Record<string, unknown>[]): SweInstance[] {
  return rows.map((r) => ({
    instance_id: String(r.instance_id),
    repo: String(r.repo),
    base_commit: String(r.base_commit),
    problem_statement: String(r.problem_statement ?? ""),
  }));
}

/** Load SWE-bench Lite instances. From a local JSON array (`file`) for offline/CI, else the HuggingFace
 * datasets-server rows API (paginated at 100), cached to `cacheFile` so a re-run is offline. */
export async function loadSweBenchLite(
  opts: { file?: string; limit?: number; cacheFile?: string; split?: string } = {},
): Promise<SweInstance[]> {
  const take = (xs: SweInstance[]) => (opts.limit ? xs.slice(0, opts.limit) : xs);
  if (opts.file) return take(normalizeRows(JSON.parse(readFileSync(opts.file, "utf8"))));
  if (opts.cacheFile && existsSync(opts.cacheFile)) {
    const cached = normalizeRows(JSON.parse(readFileSync(opts.cacheFile, "utf8")));
    if (!opts.limit || cached.length >= opts.limit) return take(cached);
  }
  const split = opts.split ?? "test";
  const want = opts.limit ?? 300;
  const out: SweInstance[] = [];
  for (let offset = 0; offset < want; offset += 100) {
    const length = Math.min(100, want - offset);
    const url = `${HF_ROWS}?dataset=princeton-nlp/SWE-bench_Lite&config=default&split=${split}&offset=${offset}&length=${length}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HF datasets-server ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { rows?: { row: Record<string, unknown> }[] };
    const rows = (body.rows ?? []).map((r) => r.row);
    if (rows.length === 0) break;
    out.push(...normalizeRows(rows));
    if (rows.length < length) break;
  }
  if (opts.cacheFile && out.length) writeFileSync(opts.cacheFile, JSON.stringify(out));
  return out;
}

/** Drive the agent against a checked-out repo to solve the issue (edits the tree in place), plus the git
 * runner and clone cache. Both seams are injected so the harness is unit-testable without git or network. */
export interface SweAgentDeps {
  runAgent: (repoDir: string, problemStatement: string) => Promise<void>;
  cacheDir: string;
  git?: (args: string[], cwd?: string) => string;
}

const defaultGit = (args: string[], cwd?: string): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** Check out `instance` at its base commit into a fresh working tree. A per-repo full clone is cached once,
 * then each instance gets a local (fast) clone off it so concurrent runs never share a working tree.
 * ponytail: full clone, not --filter=blob:none — partial-clone promisors get finicky on detached checkouts;
 * trade disk for correctness. Swap in a shallow strategy if disk matters more than a clean first run. */
export function prepareRepo(instance: SweInstance, cacheDir: string, git = defaultGit): string {
  const safe = instance.repo.replace("/", "__");
  const cache = join(cacheDir, "clones", safe);
  if (!existsSync(cache)) {
    mkdirSync(join(cacheDir, "clones"), { recursive: true });
    git(["clone", `https://github.com/${instance.repo}.git`, cache]);
  }
  const work = join(cacheDir, "work", instance.instance_id);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(cacheDir, "work"), { recursive: true });
  git(["clone", "--no-checkout", cache, work]);
  git(["checkout", "-f", instance.base_commit], work);
  return work;
}

/** Build the predictions record the official harness expects. */
export function toPrediction(instance: SweInstance, model: string, patch: string): SwePrediction {
  return { instance_id: instance.instance_id, model_name_or_path: model, model_patch: patch };
}

/** Predictions serialized as JSONL — one object per line — the format run_evaluation reads. */
export function predictionsToJsonl(preds: SwePrediction[]): string {
  return preds.map((p) => JSON.stringify(p)).join("\n") + (preds.length ? "\n" : "");
}

/** Generate one prediction: prepare the repo, let the agent edit it, capture `git diff` as the patch. An
 * agent that throws yields an empty patch (scores 0) — one bad instance never aborts the suite. */
export async function generatePrediction(instance: SweInstance, model: string, deps: SweAgentDeps): Promise<SwePrediction> {
  const git = deps.git ?? defaultGit;
  const repoDir = prepareRepo(instance, deps.cacheDir, git);
  try {
    await deps.runAgent(repoDir, instance.problem_statement);
  } catch {
    // swallow: the diff (possibly empty) is still the honest answer for this instance.
  }
  const patch = git(["diff", "--no-color"], repoDir);
  return toPrediction(instance, model, patch);
}

/** Run the suite, writing predictions.jsonl. Sequential by default: each agent run already spends test-time
 * compute and spawns shells, and parallel checkouts of multi-hundred-MB repos thrash disk.
 * ponytail: raise to a small pool if your IO budget allows. */
export async function runSweBench(
  instances: SweInstance[],
  model: string,
  deps: SweAgentDeps,
  opts: { outFile: string; onProgress?: (id: string, i: number, n: number) => void },
): Promise<SwePrediction[]> {
  const preds: SwePrediction[] = [];
  let i = 0;
  for (const inst of instances) {
    opts.onProgress?.(inst.instance_id, ++i, instances.length);
    preds.push(await generatePrediction(inst, model, deps));
    writeFileSync(opts.outFile, predictionsToJsonl(preds)); // checkpoint each instance — a crash keeps progress
  }
  return preds;
}
