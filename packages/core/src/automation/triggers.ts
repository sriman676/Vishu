import { mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { dirname } from "node:path";
import type { Autonomy } from "../reliability/approvals.js";
import type { RunLog } from "../reliability/runlog.js";
import type { DomainEvent, EventBus } from "../transport/events.js";
import type { SchedulerGate } from "./gate.js";
import { resumeIncomplete, runWorkflowDurable, type RunStore } from "./runs.js";
import { runWorkflow, type StepRunner, type WorkflowStore } from "./workflows.js";

/** What makes a trigger fire. */
export type TriggerSpec =
  | { type: "schedule"; everyMs: number } // due on the cron tick
  | { type: "event"; domain: string; eventType?: string } // an EventBus domain event
  | { type: "file"; path: string }; // a watched file/dir changes

export interface Trigger {
  id: string;
  spec: TriggerSpec;
  workflow: string; // name of the saved workflow to run
  nextDue?: number; // schedule bookkeeping (ms epoch)
}

/** Durable trigger definitions — a single JSON file so registered triggers survive restart (like the
 * WorkflowStore for workflows). ponytail: load-filter-write per save; triggers are few (no index needed). */
export class TriggerStore {
  constructor(private readonly file: string) {}
  load(): Trigger[] {
    try {
      const all = JSON.parse(readFileSync(this.file, "utf8")) as Trigger[];
      return Array.isArray(all) ? all : [];
    } catch {
      return [];
    }
  }
  save(trigger: Trigger): void {
    const all = this.load().filter((t) => t.id !== trigger.id);
    all.push({ id: trigger.id, spec: trigger.spec, workflow: trigger.workflow }); // nextDue is runtime-only
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(all, null, 2));
      renameSync(tmp, this.file); // atomic — a crash never leaves a half-written trigger file
    } catch {
      /* best-effort — a lost trigger def just isn't re-registered next boot */
    }
  }
}

export interface TriggerDeps {
  bus: EventBus;
  store: WorkflowStore;
  gate: SchedulerGate;
  run: StepRunner;
  /** Background runs only proceed unattended at `automatic`; otherwise they're parked for approval. */
  autonomy: Autonomy;
  /** Global pause predicate — while paused, no trigger fires (default: the flag-file check). */
  isPaused?: () => boolean;
  tickMs?: number; // cron heartbeat (default 5s)
  runLog?: RunLog;
  /** Durable runs (§11e): when set, firings checkpoint per-step and interrupted runs resume on start().
   * Absent → in-memory runWorkflow (a restart re-runs from the top, the prior behavior). */
  runStore?: RunStore;
  /** Durable trigger defs: when set, add() persists and start() reloads them so triggers survive restart. */
  triggerStore?: TriggerStore;
}

/** Proactive automation: a 5s cron tick fires due schedule triggers; EventBus and file-watch triggers
 * fire on their signals. Each firing runs a saved workflow, gated by the scheduler throttle + autonomy,
 * and notifies via a `system/notification` event. */
export class TriggerManager {
  private readonly triggers = new Map<string, Trigger>();
  private readonly unsubscribes: (() => void)[] = [];
  private readonly watchers: FSWatcher[] = [];
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly deps: TriggerDeps) {}

  /** Register a trigger and persist it (so it survives restart). */
  add(trigger: Trigger): void {
    this.register(trigger);
    this.deps.triggerStore?.save(trigger);
  }

  /** Wire a trigger's schedule/subscription/watcher into the live manager (no persistence — the reload
   * path calls this directly so a reloaded trigger isn't re-saved). */
  private register(trigger: Trigger): void {
    if (trigger.spec.type === "schedule") trigger.nextDue = Date.now() + trigger.spec.everyMs;
    this.triggers.set(trigger.id, trigger);
    if (trigger.spec.type === "event") {
      const spec = trigger.spec;
      this.unsubscribes.push(
        this.deps.bus.subscribeDomain(spec.domain, (e) => {
          if (!spec.eventType || e.type === spec.eventType) void this.fire(trigger, e);
        }),
      );
    } else if (trigger.spec.type === "file") {
      const w = watch(trigger.spec.path, () => void this.fire(trigger));
      w.on("error", (err) => this.deps.runLog?.log("trigger_watch_error", `${trigger.id}: ${err.message}`));
      this.watchers.push(w);
    }
  }

  list(): Trigger[] {
    return [...this.triggers.values()];
  }

  /** One cron pass — fires every schedule trigger that is due. start() calls this on an interval;
   * tests call it directly for determinism. */
  tick(now = Date.now()): void {
    for (const t of this.triggers.values()) {
      if (t.spec.type === "schedule" && t.nextDue !== undefined && now >= t.nextDue) {
        t.nextDue = now + t.spec.everyMs;
        void this.fire(t);
      }
    }
  }

  start(): void {
    // Reload persisted triggers first (survive restart) — skip any id already registered live this boot.
    for (const t of this.deps.triggerStore?.load() ?? []) if (!this.triggers.has(t.id)) this.register(t);
    // §11e: pick up any run interrupted by the last shutdown before the cron begins firing new ones.
    if (this.deps.runStore) void resumeIncomplete(this.deps.runStore, (n) => this.deps.store.get(n), this.deps.run);
    this.timer ??= setInterval(() => this.tick(), this.deps.tickMs ?? 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const off of this.unsubscribes) off();
    for (const w of this.watchers) w.close();
    this.unsubscribes.length = 0;
    this.watchers.length = 0;
  }

  private async fire(trigger: Trigger, cause?: DomainEvent): Promise<void> {
    if (this.deps.isPaused?.()) {
      this.deps.runLog?.log("trigger_paused", `${trigger.id} skipped (global pause)`);
      return;
    }
    if (!this.deps.gate.allows()) {
      this.deps.runLog?.log("trigger_throttled", trigger.id);
      return;
    }
    if (this.deps.autonomy !== "automatic") {
      this.deps.runLog?.log("trigger_parked", `${trigger.id} needs approval (autonomy=${this.deps.autonomy})`);
      this.deps.bus.publish({ domain: "system", type: "notification", payload: { trigger: trigger.id, status: "needs_approval" } });
      return;
    }
    const wf = this.deps.store.get(trigger.workflow);
    if (!wf) {
      this.deps.runLog?.log("trigger_error", `${trigger.id}: unknown workflow ${trigger.workflow}`);
      return;
    }
    this.deps.runLog?.log("trigger_fire", `${trigger.id} → ${wf.name}${cause ? ` (${cause.domain}/${cause.type})` : ""}`);
    try {
      const outputs = this.deps.runStore
        ? (await runWorkflowDurable(wf, this.deps.run, this.deps.runStore)).outputs // §11e durable + resumable
        : await runWorkflow(wf, this.deps.run);
      this.deps.bus.publish({ domain: "system", type: "notification", payload: { trigger: trigger.id, workflow: wf.name, outputs } });
    } catch (e) {
      this.deps.runLog?.log("trigger_error", `${trigger.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
