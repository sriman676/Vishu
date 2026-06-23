import { watch, type FSWatcher } from "node:fs";
import type { Autonomy } from "../reliability/approvals.js";
import type { RunLog } from "../reliability/runlog.js";
import type { DomainEvent, EventBus } from "../transport/events.js";
import type { SchedulerGate } from "./gate.js";
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

export interface TriggerDeps {
  bus: EventBus;
  store: WorkflowStore;
  gate: SchedulerGate;
  run: StepRunner;
  /** Background runs only proceed unattended at `automatic`; otherwise they're parked for approval. */
  autonomy: Autonomy;
  tickMs?: number; // cron heartbeat (default 5s)
  runLog?: RunLog;
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

  add(trigger: Trigger): void {
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
      const outputs = await runWorkflow(wf, this.deps.run);
      this.deps.bus.publish({ domain: "system", type: "notification", payload: { trigger: trigger.id, workflow: wf.name, outputs } });
    } catch (e) {
      this.deps.runLog?.log("trigger_error", `${trigger.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
