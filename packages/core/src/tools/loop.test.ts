import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ScriptedProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import { makePolicy, SecurityError } from "../security/policy.js";
import { registerBuiltins } from "./builtins.js";
import { runToolLoop } from "./loop.js";
import { ToolRegistry } from "./registry.js";
import { Terminal } from "./terminal.js";

test("tool loop builds and runs a tiny app inside action_dir, then blocks an escape", async () => {
  const actionDir = mkdtempSync(join(tmpdir(), "vishu-act-"));
  const registry = registerBuiltins(new ToolRegistry());
  const policy = makePolicy("full", actionDir);

  // Scripted model: write a file, run it, then finish.
  const router = new Router([
    new ScriptedProvider([
      {
        content: "",
        finish: "tool_calls",
        toolCalls: [{ id: "1", name: "write_file", arguments: { path: "app.js", content: "console.log('hello vishu')" } }],
      },
      {
        content: "",
        finish: "tool_calls",
        toolCalls: [{ id: "2", name: "run_shell", arguments: { command: "node app.js" } }],
      },
      { content: "done", finish: "stop" },
    ]),
  ]);

  const result = await runToolLoop(
    { router, registry, policy, terminal: new Terminal(actionDir), model: "scripted" },
    [{ role: "user", content: "build it" }],
  );

  assert.equal(result.final, "done");
  assert.ok(existsSync(join(actionDir, "app.js")));
  const ran = result.messages.find((m) => m.role === "tool" && m.name === "run_shell");
  assert.match(ran?.content ?? "", /hello vishu/);

  // A write outside action_dir is blocked by the path jail.
  await assert.rejects(
    registry.get("write_file").run({ path: "../escape.txt", content: "x" }, { policy, terminal: new Terminal(actionDir) }),
    SecurityError,
  );
});

test("a denied tool call surfaces the escalation status back to the model", async () => {
  const actionDir = mkdtempSync(join(tmpdir(), "vishu-act-"));
  const registry = registerBuiltins(new ToolRegistry());
  const policy = makePolicy("full", actionDir);
  const router = new Router([
    new ScriptedProvider([
      { content: "", finish: "tool_calls", toolCalls: [{ id: "1", name: "write_file", arguments: { path: "x.txt", content: "hi" } }] },
      { content: "understood", finish: "stop" },
    ]),
  ]);

  const result = await runToolLoop(
    {
      router,
      registry,
      policy,
      terminal: new Terminal(actionDir),
      model: "scripted",
      approve: async () => ({ allowed: false, status: "needs_context", reason: "paused (global pause active)" }),
    },
    [{ role: "user", content: "write it" }],
  );

  const denied = result.messages.find((m) => m.role === "tool" && m.name === "write_file");
  assert.match(denied?.content ?? "", /denied \(needs_context\): paused/); // status graded, not a bare deny
  assert.equal(result.final, "understood");
});
