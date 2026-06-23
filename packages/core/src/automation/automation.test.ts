import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EventBus } from "../transport/events.js";
import { SchedulerGate } from "./gate.js";
import { attachNotificationSink } from "./notify.js";
import { evalGate } from "./sensor.js";
import { TriggerManager } from "./triggers.js";
import { WorkflowStore } from "./workflows.js";

test("resource sensor: pauses the gate when busy, resumes when idle", () => {
  assert.equal(evalGate(0.99, 0.85), "paused");
  assert.equal(evalGate(0.2, 0.85), "always_on");
});

test("notification sink: delivers system/notification events, ignores other system events", () => {
  const bus = new EventBus();
  const seen: unknown[] = [];
  const off = attachNotificationSink(bus, (e) => seen.push(e.payload));
  bus.publish({ domain: "system", type: "notification", payload: { msg: "hi" } });
  bus.publish({ domain: "system", type: "other", payload: { msg: "skip" } });
  off();
  assert.deepEqual(seen, [{ msg: "hi" }]);
});

function setup(autonomy: "automatic" | "ask_every_time" = "automatic") {
  const store = new WorkflowStore(mkdtempSync(join(tmpdir(), "vishu-wf-")));
  const bus = new EventBus();
  const gate = new SchedulerGate();
  const ran: string[] = [];
  const manager = new TriggerManager({ bus, store, gate, autonomy, run: async (step) => (ran.push(step), `did: ${step}`) });
  return { store, bus, gate, manager, ran };
}

const drain = () => new Promise((r) => setImmediate(r)); // let fire-and-forget workflow runs settle

test("a scheduled trigger fires on the cron tick and runs a saved workflow unattended", async () => {
  const { store, manager, ran } = setup();
  store.save({ name: "morning", steps: ["fetch news", "summarize"] });
  manager.add({ id: "t1", spec: { type: "schedule", everyMs: 1000 }, workflow: "morning" });

  manager.tick(Date.now()); // not due yet (nextDue is now+1000)
  assert.deepEqual(ran, []);

  manager.tick(Date.now() + 2000); // now past due → fires the whole workflow, no human in the loop
  await drain();
  assert.deepEqual(ran, ["fetch news", "summarize"]);
});

test("an event trigger fires when its EventBus domain event arrives", async () => {
  const { store, bus, manager, ran } = setup();
  store.save({ name: "on-msg", steps: ["triage inbound"] });
  manager.add({ id: "t2", spec: { type: "event", domain: "channel", eventType: "inbound" }, workflow: "on-msg" });

  bus.publish({ domain: "channel", type: "other" }); // wrong type → ignored
  bus.publish({ domain: "channel", type: "inbound" }); // match → fires
  await new Promise((r) => setImmediate(r)); // let the async fire settle
  assert.deepEqual(ran, ["triage inbound"]);
});

test("background runs are parked (not run) unless autonomy is automatic", () => {
  const { store, manager, ran } = setup("ask_every_time");
  store.save({ name: "risky", steps: ["do it"] });
  manager.add({ id: "t3", spec: { type: "schedule", everyMs: 10 }, workflow: "risky" });
  manager.tick(Date.now() + 1000);
  assert.deepEqual(ran, []); // parked for approval, not executed unattended
});

test("the scheduler gate throttles background firing when paused", async () => {
  const { store, gate, manager, ran } = setup();
  store.save({ name: "bg", steps: ["work"] });
  manager.add({ id: "t4", spec: { type: "schedule", everyMs: 10 }, workflow: "bg" });
  gate.set("paused");
  manager.tick(Date.now() + 1000);
  await drain();
  assert.deepEqual(ran, []); // throttled
  gate.set("always_on");
  manager.tick(Date.now() + 3000); // past the rescheduled due time → now fires
  await drain();
  assert.deepEqual(ran, ["work"]);
});
