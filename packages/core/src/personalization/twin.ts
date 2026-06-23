import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Workflow, WorkflowStore } from "../automation/workflows.js";

/** Phase 13 digital twin (small-first, no ML): notice tasks the user repeats, and when one crosses a
 * threshold, suggest saving it as a Workflow they can accept. A repeat is matched on a normalized
 * signature (case/whitespace-folded); the first-seen original text is kept as the suggestion sample.
 * ponytail: frequency count over a JSON file — no embeddings/clustering. Auto-recording is a one-line
 * `twin.record(prompt)` hook in the agent loop (named integration point); usage-pattern clustering and
 * a richer "profile" are the named upgrades. */
interface TwinData {
  tasks: Record<string, { count: number; sample: string }>;
  accepted: string[];
}

function tidy(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
function normalize(text: string): string {
  return tidy(text).toLowerCase();
}

export class DigitalTwin {
  private data: TwinData = { tasks: {}, accepted: [] };

  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) this.data = JSON.parse(readFileSync(file, "utf8")) as TwinData;
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file); // atomic: a crash mid-write never corrupts the store
  }

  /** Record one task occurrence; returns its running count. */
  record(text: string): number {
    const key = normalize(text);
    if (!key) return 0;
    const t = (this.data.tasks[key] ??= { count: 0, sample: tidy(text) });
    t.count += 1;
    this.persist();
    return t.count;
  }

  /** Repeated-enough tasks not yet accepted — the suggestions to offer the user. */
  suggestions(threshold = 3): string[] {
    return Object.entries(this.data.tasks)
      .filter(([key, t]) => t.count >= threshold && !this.data.accepted.includes(key))
      .map(([, t]) => t.sample);
  }

  /** Accept a suggestion: save it as a single-step Workflow and stop suggesting it. */
  accept(text: string, workflows: WorkflowStore): Workflow {
    const key = normalize(text);
    const sample = this.data.tasks[key]?.sample ?? tidy(text);
    const wf: Workflow = { name: sample, steps: [sample] };
    workflows.save(wf);
    if (!this.data.accepted.includes(key)) this.data.accepted.push(key);
    this.persist();
    return wf;
  }
}
