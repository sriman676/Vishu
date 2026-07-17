import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type StepRunner, type Workflow } from "./workflows.js";

/**
 * Durable workflow runs (UPGRADES §11e). A WorkflowRun is the persisted state of one execution, so a
 * crash/restart resumes at the first unfinished step instead of re-running completed steps (which for a
 * send/spend workflow would duplicate side effects). ponytail: JSON-per-run file store, no Temporal —
 * single-VM PA doesn't need a workflow engine; add retry/backoff policy only if a step needs it.
 */
export interface WorkflowRun {
  id: string;
  workflow: string;
  steps: string[];
  cursor: number; // index of the next step to run; [0..cursor) are done
  outputs: string[];
  status: "running" | "done" | "failed";
  error?: string;
  updated: string; // ISO
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

/** Persists WorkflowRun records as one atomic JSON file per run. */
export class RunStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  private file(id: string): string {
    return join(this.dir, `${slug(id)}.json`);
  }
  save(run: WorkflowRun): void {
    const final = this.file(run.id);
    const tmp = `${final}.tmp`;
    writeFileSync(tmp, JSON.stringify(run, null, 2));
    renameSync(tmp, final); // atomic on the same volume — a crash never leaves a half-written run
  }
  get(id: string): WorkflowRun | undefined {
    const p = this.file(id);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as WorkflowRun) : undefined;
  }
  list(): WorkflowRun[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as WorkflowRun);
  }
  remove(id: string): void {
    rmSync(this.file(id), { force: true });
  }
}

/**
 * Run a workflow durably: checkpoint progress after every step. When `id` names a run already left
 * "running", resume it from its cursor (the restart path) instead of starting over. A failing step
 * marks the run "failed" at its cursor and rethrows, so resumeIncomplete() retries from that step.
 */
export async function runWorkflowDurable(
  wf: Workflow,
  run: StepRunner,
  store: RunStore,
  id = `${wf.name}-${Date.now().toString(36)}`,
): Promise<WorkflowRun> {
  const existing = store.get(id);
  const rec: WorkflowRun =
    existing?.status === "running"
      ? existing
      : { id, workflow: wf.name, steps: wf.steps, cursor: 0, outputs: [], status: "running", updated: new Date().toISOString() };
  store.save(rec);
  for (; rec.cursor < rec.steps.length; rec.cursor++) {
    try {
      rec.outputs.push(await run(rec.steps[rec.cursor]!));
    } catch (e) {
      rec.status = "failed";
      rec.error = e instanceof Error ? e.message : String(e);
      rec.updated = new Date().toISOString();
      store.save(rec); // persisted AT the failed cursor so resume retries this exact step
      throw e;
    }
    rec.updated = new Date().toISOString();
    store.save(rec); // checkpoint after each completed step
  }
  rec.status = "done";
  rec.updated = new Date().toISOString();
  store.save(rec);
  return rec;
}

/**
 * Resume every run left "running" (interrupted) or "failed" (retry). `byName` resolves a run's workflow
 * (definitions may have changed — a missing one is skipped). Best-effort: one run's failure never blocks
 * the rest. Returns the ids that completed.
 */
export async function resumeIncomplete(
  store: RunStore,
  byName: (name: string) => Workflow | undefined,
  run: StepRunner,
): Promise<string[]> {
  const resumed: string[] = [];
  for (const rec of store.list()) {
    if (rec.status === "done") continue;
    const wf = byName(rec.workflow);
    if (!wf) continue;
    rec.status = "running"; // flip so runWorkflowDurable takes the resume branch
    store.save(rec);
    try {
      await runWorkflowDurable(wf, run, store, rec.id);
      resumed.push(rec.id);
    } catch {
      /* stays failed at its cursor; a later resume retries */
    }
  }
  return resumed;
}
