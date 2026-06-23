import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ToolRegistry } from "../tools/registry.js";
import { EventBus } from "../transport/events.js";
import { Registry } from "../transport/rpc.js";
import { MODULES } from "./all.js";
import { enabledModules, loadModules, type VishuModule } from "./registry.js";
import { cmpVersion } from "./selfupdate.js";

const ctx = () => ({ tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir: mkdtempSync(join(tmpdir(), "vishu-mod-")) });

test("modules: off by default — the core registry is untouched when no flags are set", async () => {
  const c = ctx();
  const on = await loadModules(MODULES, c, enabledModules({})); // VISHU_MODULES unset
  assert.deepEqual(on, []);
  assert.deepEqual(c.tools.schemas(), []); // no tools added — core unaffected when off
});

test("modules: an enabled module wires its tools and works end-to-end", async () => {
  const c = ctx();
  const on = await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "artifacts" }));
  assert.deepEqual(on, ["artifacts"]);
  const names = c.tools.schemas().map((s) => s.name).sort();
  assert.deepEqual(names, ["artifact_list", "artifact_save"]);

  const toolCtx = {} as never; // these tools don't use policy/terminal
  assert.equal(await c.tools.get("artifact_save").run({ name: "note.txt", content: "hello" }, toolCtx), "saved note.txt");
  assert.equal(await c.tools.get("artifact_list").run({ name: "note.txt" }, toolCtx), "hello");
  assert.match(await c.tools.get("artifact_list").run({}, toolCtx), /note\.txt/);
});

test("modules: pairing issues a single-use code and verifies it once", async () => {
  const c = ctx();
  await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "pairing" }));
  const t = {} as never;
  const code = await c.tools.get("pair_request").run({}, t);
  assert.match(code, /^[0-9a-f]{8}$/);
  assert.equal(await c.tools.get("pair_verify").run({ code }, t), "ok");
  assert.equal(await c.tools.get("pair_verify").run({ code }, t), "invalid"); // single-use: consumed
});

test("self-update: compares versions and reports availability", async () => {
  assert.equal(cmpVersion("1.2.0", "1.1.9"), 1);
  assert.equal(cmpVersion("1.0.0", "1.0.0"), 0);
  const c = ctx();
  await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "self-update" }));
  const out = JSON.parse(await c.tools.get("self_update_check").run({ latest: "999.0.0" }, {} as never));
  assert.equal(out.updateAvailable, true);
});

test("modules: a failing module is skipped, never crashing the core", async () => {
  const boom: VishuModule = { name: "boom", setup: () => { throw new Error("kaboom"); } };
  const c = ctx();
  const on = await loadModules([boom, ...MODULES], c, enabledModules({ VISHU_MODULES: "boom,artifacts" }));
  assert.deepEqual(on, ["artifacts"]); // boom skipped, artifacts still loaded
});
