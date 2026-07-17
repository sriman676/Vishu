import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import type { ModuleContext } from "./registry.js";
import { devopsModule } from "./devops.js";

function setup(): ToolRegistry {
  const tools = new ToolRegistry();
  devopsModule.setup({ tools, rpc: {} as never, bus: {} as never, workspaceDir: "" } as ModuleContext);
  return tools;
}

/** A ToolContext whose Terminal just echoes the command it was given (exit 0), so a tool's shell string
 * is observable without a real shell. */
function ctx(): { ctx: ToolContext; ran: string[] } {
  const ran: string[] = [];
  const terminal = { exec: async (c: string) => (ran.push(c), { stdout: c, exitCode: 0 }) };
  return { ctx: { policy: {} as never, terminal } as unknown as ToolContext, ran };
}

test("devops: push/deploy are send-class (always gated); commit/format write; status/diff/lint read", () => {
  const t = setup();
  assert.equal(t.get("dev_push").meta?.action, "send", "push must always ask");
  assert.equal(t.get("dev_deploy").meta?.action, "send", "deploy must always ask");
  assert.equal(t.get("dev_commit").meta?.action, "write");
  assert.equal(t.get("dev_test").meta?.action, "write");
  assert.equal(t.get("dev_status").meta?.action, "read");
  assert.equal(t.get("dev_diff").meta?.action, "read");
  assert.equal(t.get("dev_lint").meta?.action, "read");
});

test("devops: dev_commit rejects a shell-breaking message and never runs the commit", async () => {
  const t = setup();
  const { ctx: c, ran } = ctx();
  const bad = await t.get("dev_commit").run({ message: 'oops"; rm -rf /' }, c);
  assert.match(bad, /must be a single line/);
  assert.equal(ran.length, 0, "no git command ran for an unsafe message");

  const ok = await t.get("dev_commit").run({ message: "add feature x" }, c);
  assert.deepEqual(ran, ["git add -A", 'git commit -m "add feature x"'], "safe message stages then commits");
  assert.match(ok, /exit 0/);
});

test("devops: dev_push validates the ref and builds the expected command", async () => {
  const t = setup();
  const { ctx: c, ran } = ctx();
  assert.match(await t.get("dev_push").run({ branch: "bad;branch" }, c), /may contain only/);
  assert.equal(ran.length, 0);

  await t.get("dev_push").run({ remote: "origin", branch: "main" }, c);
  assert.deepEqual(ran, ["git push origin main"]);
});
