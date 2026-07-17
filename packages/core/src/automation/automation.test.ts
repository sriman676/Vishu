import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Registry } from "../transport/rpc.js";
import { EventBus } from "../transport/events.js";
import { registerAutomation } from "./rpc.js";
import { SchedulerGate } from "./gate.js";
import { attachNotificationSink } from "./notify.js";
import { evalGate } from "./sensor.js";
import { TriggerManager, TriggerStore } from "./triggers.js";
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

test("§12d builder round-trip: save_workflow + add_trigger persist to triggers.json and show in automation_list", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-12d-"));
  const store = new WorkflowStore(join(dir, "workflows"));
  const triggerFile = join(dir, "triggers.json");
  const manager = new TriggerManager({
    bus: new EventBus(),
    store,
    gate: new SchedulerGate(),
    autonomy: "automatic",
    run: async (s) => s,
    triggerStore: new TriggerStore(triggerFile),
  });
  const rpc = new Registry();
  registerAutomation(rpc, store, manager);
  const call = (method: string, params: unknown) => rpc.handle({ jsonrpc: "2.0", id: 1, method, params });

  // create → save the workflow, then attach a schedule trigger (the exact calls the UI Save button makes).
  assert.equal((await call("vishu.automation_save_workflow", { name: "digest", steps: ["fetch", "summarize"] })).result?.ok, true);
  assert.equal((await call("vishu.automation_add_trigger", { id: "d1", spec: { type: "schedule", everyMs: 3_600_000 }, workflow: "digest" })).result?.ok, true);

  // the trigger persisted to triggers.json (survives restart)…
  const persisted = JSON.parse(readFileSync(triggerFile, "utf8")) as { id: string; workflow: string }[];
  assert.deepEqual(persisted.map((t) => [t.id, t.workflow]), [["d1", "digest"]]);

  // …and both show up in automation_list.
  const listed = (await call("vishu.automation_list", null)).result as { result: { workflows: { name: string }[]; triggers: { id: string }[] } };
  assert.deepEqual(listed.result.workflows.map((w) => w.name), ["digest"]);
  assert.deepEqual(listed.result.triggers.map((t) => t.id), ["d1"]);
});

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
