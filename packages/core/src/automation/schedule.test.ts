import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EventBus } from "../transport/events.js";
import type { ToolContext } from "../tools/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { SchedulerGate } from "./gate.js";
import { registerScheduleTools } from "./schedule.js";
import { TriggerManager } from "./triggers.js";
import { WorkflowStore } from "./workflows.js";

function setup() {
  const store = new WorkflowStore(mkdtempSync(join(tmpdir(), "vishu-sched-")));
  const ran: string[] = [];
  const manager = new TriggerManager({ bus: new EventBus(), store, gate: new SchedulerGate(), autonomy: "automatic", run: async (s) => (ran.push(s), s) });
  const reg = new ToolRegistry();
  registerScheduleTools(reg, { store, manager });
  const ctx = {} as ToolContext;
  return { store, manager, ran, reg, ctx };
}

test("schedule_task saves a workflow + a recurring trigger that then fires", async () => {
  const { store, manager, ran, reg, ctx } = setup();
  const out = await reg.get("schedule_task").run({ name: "Morning Brief", steps: ["fetch news", "summarize"], everyMinutes: 30 }, ctx);
  assert.match(out, /id: morning-brief/);
  assert.deepEqual(store.get("Morning Brief")?.steps, ["fetch news", "summarize"]);
  assert.equal(manager.list().length, 1);

  manager.tick(Date.now() + 31 * 60_000); // past the 30-min due → fires the saved workflow
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ran, ["fetch news", "summarize"]);
});

test("schedule_task validates its inputs", async () => {
  const { reg, ctx } = setup();
  assert.match(await reg.get("schedule_task").run({ name: "", steps: ["x"], everyMinutes: 5 }, ctx), /name is required/);
  assert.match(await reg.get("schedule_task").run({ name: "t", steps: [], everyMinutes: 5 }, ctx), /at least one step/);
  assert.match(await reg.get("schedule_task").run({ name: "t", steps: ["x"], everyMinutes: 0 }, ctx), /positive number/);
});

test("list_tasks + cancel_task reflect and remove scheduled tasks", async () => {
  const { manager, reg, ctx } = setup();
  await reg.get("schedule_task").run({ name: "brief", steps: ["go"], everyMinutes: 60 }, ctx);
  assert.match(await reg.get("list_tasks").run({}, ctx), /brief — every 60 min/);
  assert.match(await reg.get("cancel_task").run({ id: "brief" }, ctx), /Cancelled task "brief"/);
  assert.equal(manager.list().length, 0);
  assert.match(await reg.get("cancel_task").run({ id: "brief" }, ctx), /No task with id/);
  assert.equal(await reg.get("list_tasks").run({}, ctx), "No scheduled tasks.");
});
