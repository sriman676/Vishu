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
  tasks: Record<string, { count: number; sample: string; hours?: number[] }>;
  accepted: string[];
  /** key → local YYYY-M-D it was last anticipated, so the tick nudges at most once per task per day. */
  anticipated?: Record<string, string>;
}

/** Local calendar day key (not UTC) — anticipation dedups on the user's day, not the server's. */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
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

  /** Record one task occurrence at time `at`; returns its running count. Also bumps a 24-bucket
   * hour-of-day histogram so `anticipate()` can learn *when* the task recurs. */
  record(text: string, at = Date.now()): number {
    const key = normalize(text);
    if (!key) return 0;
    const t = (this.data.tasks[key] ??= { count: 0, sample: tidy(text) });
    t.count += 1;
    (t.hours ??= new Array(24).fill(0))[new Date(at).getHours()] += 1;
    this.persist();
    return t.count;
  }

  /** Learned anticipatory signal (proactivity v2): tasks whose occurrences cluster at the CURRENT
   * hour-of-day, surfaced at most once per task per day. This is the behavior-driven layer over the
   * frequency threshold — it anticipates from *when* you repeat a task, not just how often. Returns the
   * samples to nudge and marks them anticipated-today so a recurring tick never re-fires the same day.
   * ponytail: modal-hour match over the histogram — no seasonality/weekday/ML model; that's the named
   * upgrade and it rides this same seam. */
  anticipate(now = Date.now(), minCount = 3): string[] {
    const hour = new Date(now).getHours();
    const today = dayKey(now);
    const anticipated = (this.data.anticipated ??= {});
    const due: string[] = [];
    for (const [key, t] of Object.entries(this.data.tasks)) {
      if (t.count < minCount || this.data.accepted.includes(key) || !t.hours) continue;
      const peak = t.hours.indexOf(Math.max(...t.hours));
      if (peak !== hour || t.hours[hour] === 0) continue; // current hour must be the learned peak
      if (anticipated[key] === today) continue; // already nudged today
      anticipated[key] = today;
      due.push(t.sample);
    }
    if (due.length) this.persist();
    return due;
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
