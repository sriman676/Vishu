import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Registry } from "../transport/rpc.js";
import { registerAutofix } from "./rpc.js";

test("vishu.autofix: a passing command verifies green without invoking the agent", async () => {
  const reg = new Registry();
  let agentCalls = 0;
  registerAutofix(reg, {
    actionDir: mkdtempSync(join(tmpdir(), "vishu-fix-")),
    autonomy: "automatic",
    runAgent: async () => {
      agentCalls += 1;
      return "";
    },
  });

  const res = await reg.handle({ jsonrpc: "2.0", id: 1, method: "vishu.autofix", params: { command: "echo ok" } });
  const out = res.result as { ok: true; result: { ran: boolean; ok: boolean; attempts: number } };
  assert.equal(out.ok, true);
  assert.equal(out.result.ok, true); // command exited 0
  assert.equal(out.result.ran, false); // nothing to fix
  assert.equal(agentCalls, 0); // agent never dispatched

  const bad = await reg.handle({ jsonrpc: "2.0", id: 2, method: "vishu.autofix", params: {} });
  assert.equal((bad.result as { ok: boolean }).ok, false); // command is required
});
