import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolRegistry } from "../tools/registry.js";
import { EventBus } from "../transport/events.js";
import { Registry } from "../transport/rpc.js";
import { MODULES } from "./all.js";
import { composeBrief } from "./daily.js";
import { enabledModules, loadModules } from "./registry.js";

test("composeBrief: renders both sources, degrades a missing one to a hint (never errors)", () => {
  assert.match(composeBrief("2 unread", "10am sync"), /📧 Email\n2 unread[\s\S]*📅 Calendar\n10am sync/);
  assert.match(composeBrief(null, null), /Email — not connected[\s\S]*Calendar — not connected/);
  assert.match(composeBrief("x", null), /📧 Email\nx[\s\S]*Calendar — not connected/);
});

test("daily_brief RPC: discovers mounted email+calendar tools by name, degrades when unmounted", async () => {
  const rpc = new Registry();
  const tools = new ToolRegistry();
  const c = { tools, rpc, bus: new EventBus(), workspaceDir: "." };
  await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "daily" }));
  const call = (method: string, params: unknown) => rpc.handle({ jsonrpc: "2.0", id: 1, method, params });

  // Nothing mounted yet → a graceful "not connected" brief, never an error.
  let r = await call("vishu.daily_brief", {});
  assert.equal(r.result?.ok, true);
  assert.match((r.result as { result: { brief: string } }).result.brief, /not connected/);

  // Mount fake Composio Gmail + Calendar read tools; the brief now folds in their output.
  tools.register({ name: "composio__GMAIL_FETCH_EMAILS", description: "", parameters: { type: "object", properties: {} }, run: async () => "2 unread: standup, invoice" });
  tools.register({ name: "composio__GOOGLECALENDAR_EVENTS_LIST", description: "", parameters: { type: "object", properties: {} }, run: async () => "10am sync, 2pm review" });
  r = await call("vishu.daily_brief", {});
  const brief = (r.result as { result: { brief: string } }).result.brief;
  assert.match(brief, /2 unread: standup, invoice/);
  assert.match(brief, /10am sync, 2pm review/);

  // A throwing tool surfaces inline, not as a failed brief.
  const tools2 = new ToolRegistry();
  const c2 = { tools: tools2, rpc: new Registry(), bus: new EventBus(), workspaceDir: "." };
  await loadModules(MODULES, c2, enabledModules({ VISHU_MODULES: "daily" }));
  tools2.register({ name: "gmail__list", description: "", parameters: { type: "object", properties: {} }, run: async () => { throw new Error("boom"); } });
  const r2 = await c2.rpc.handle({ jsonrpc: "2.0", id: 1, method: "vishu.daily_brief", params: {} });
  assert.match((r2.result as { result: { brief: string } }).result.brief, /gmail__list failed: boom/);
});
