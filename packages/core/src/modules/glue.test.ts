import assert from "node:assert/strict";
import { test } from "node:test";
import { EventBus } from "../transport/events.js";
import { ToolRegistry } from "../tools/registry.js";
import { glueModule, scheduleReminder } from "./glue.js";

test("glue tools register with non-destructive action classes", () => {
  const tools = new ToolRegistry();
  glueModule.setup({ tools, rpc: {} as never, bus: new EventBus(), workspaceDir: "" });
  assert.equal(tools.getAction("clipboard_read"), "read");
  assert.equal(tools.getAction("clipboard_write"), "write");
  assert.equal(tools.getAction("app_launch"), "write");
  assert.equal(tools.getAction("reminder_set"), "write");
});

test("reminder_set validates input; scheduleReminder fires a notification", async () => {
  const tools = new ToolRegistry();
  const bus = new EventBus();
  glueModule.setup({ tools, rpc: {} as never, bus, workspaceDir: "" });
  assert.match(String(await tools.get("reminder_set").run({ minutes: 0, text: "x" }, {} as never)), /positive number/);

  const fired: unknown[] = [];
  bus.subscribeDomain("system", (e) => e.type === "notification" && fired.push(e.payload));
  scheduleReminder(bus, 5, "stand up");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fired.length, 1);
  assert.equal((fired[0] as { kind: string }).kind, "reminder");
});
