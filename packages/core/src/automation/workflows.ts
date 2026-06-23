import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A saved, repeatable automation: an ordered list of steps. A step is a plain instruction string;
 * the injected StepRunner decides how to execute it (default wiring runs each as an agent turn). */
export interface Workflow {
  name: string;
  steps: string[];
}

export type StepRunner = (step: string) => Promise<string>;

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workflow";
}

/** Persists workflows as JSON under a directory (atomic writes). */
export class WorkflowStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(name: string): string {
    return join(this.dir, `${slug(name)}.json`);
  }

  save(wf: Workflow): void {
    const final = this.file(wf.name);
    const tmp = `${final}.tmp`;
    writeFileSync(tmp, JSON.stringify(wf, null, 2));
    renameSync(tmp, final);
  }

  get(name: string): Workflow | undefined {
    const path = this.file(name);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Workflow) : undefined;
  }

  list(): Workflow[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf8")) as Workflow);
  }
}

/** Run a workflow's steps in order; returns each step's output. A failed step stops the run (the
 * caller logs it) so a broken automation doesn't silently half-execute. */
export async function runWorkflow(wf: Workflow, run: StepRunner): Promise<string[]> {
  const outputs: string[] = [];
  for (const step of wf.steps) outputs.push(await run(step));
  return outputs;
}
