import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EventBus } from "../transport/events.js";
import { SchedulerGate } from "./gate.js";
import { TriggerManager, TriggerStore } from "./triggers.js";
import { WorkflowStore } from "./workflows.js";

function ws(): string {
  return mkdtempSync(join(tmpdir(), "vishu-trig-"));
}

test("TriggerStore persists trigger defs and dedupes by id", () => {
  const store = new TriggerStore(join(ws(), "triggers.json"));
  store.save({ id: "t1", spec: { type: "schedule", everyMs: 1000 }, workflow: "wf", nextDue: 999 });
  store.save({ id: "t1", spec: { type: "schedule", everyMs: 2000 }, workflow: "wf" }); // overwrite
  store.save({ id: "t2", spec: { type: "file", path: "x" }, workflow: "wf" });
  const all = store.load();
  assert.equal(all.length, 2);
  const t1 = all.find((t) => t.id === "t1")!;
  assert.equal(t1.spec.type === "schedule" && t1.spec.everyMs, 2000);
  assert.equal(t1.nextDue, undefined); // runtime bookkeeping isn't persisted
});

test("a schedule trigger registered in one manager fires after a restart via the store", () => {
  const dir = ws();
  const wfStore = new WorkflowStore(join(dir, "workflows"));
  wfStore.save({ name: "wf", steps: ["do it"] });
  const triggerStore = new TriggerStore(join(dir, "triggers.json"));
  const ran: string[] = [];
  const deps = (bus: EventBus) => ({
    bus,
    store: wfStore,
    gate: new SchedulerGate(),
    autonomy: "automatic" as const,
    run: async (step: string) => (ran.push(step), step),
    triggerStore,
  });

  // Boot 1: register a due schedule trigger, then "crash" (drop the manager) without ticking.
  const m1 = new TriggerManager(deps(new EventBus()));
  m1.add({ id: "daily", spec: { type: "schedule", everyMs: 1 }, workflow: "wf" });
  m1.stop();

  // Boot 2: a fresh manager only reloads from disk on start(); the trigger must come back and fire.
  const m2 = new TriggerManager(deps(new EventBus()));
  assert.equal(m2.list().length, 0); // nothing registered until start() reloads
  m2.start();
  assert.equal(m2.list().some((t) => t.id === "daily"), true);
  m2.tick(Date.now() + 10); // past due → fires
  m2.stop();
  return new Promise((r) => setTimeout(r, 20)).then(() => assert.deepEqual(ran, ["do it"]));
});
