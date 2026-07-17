import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ToolRegistry } from "../tools/registry.js";
import { EventBus } from "../transport/events.js";
import { Registry } from "../transport/rpc.js";
import { MODULES } from "./all.js";
import { enabledModules, loadModules } from "./registry.js";

// A node stub standing in for the OS screenshot tool: writes a fake PNG to the {out} path it's given.
const WRITE_STUB = `require("fs").writeFileSync(process.argv[1],"PNGDATA");`;
const NOOP_STUB = `0;`; // exits 0 but writes nothing

function ctx() {
  return { tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir: mkdtempSync(join(tmpdir(), "vishu-desk-")) };
}

test("screen_capture: runs the capture command and returns the saved PNG path", async () => {
  const prev = process.env.VISHU_SCREENSHOT_CMD;
  process.env.VISHU_SCREENSHOT_CMD = JSON.stringify(["node", "-e", WRITE_STUB, "{out}"]);
  const c = ctx();
  try {
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "desktop" }));
    const out = await c.tools.get("screen_capture").run({ name: "shot" }, {} as never);
    assert.ok(existsSync(out), `expected file at ${out}`);
    assert.equal(readFileSync(out, "utf8"), "PNGDATA");
    assert.ok(out.endsWith(".png"));
  } finally {
    rmSync(c.workspaceDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.VISHU_SCREENSHOT_CMD;
    else process.env.VISHU_SCREENSHOT_CMD = prev;
  }
});

test("desktop input tools are all send-class (F0 gate always asks)", async () => {
  const c = ctx();
  try {
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "desktop" }));
    for (const t of ["desktop_type", "desktop_key", "desktop_click"]) assert.equal(c.tools.getAction(t), "send", t);
  } finally {
    rmSync(c.workspaceDir, { recursive: true, force: true });
  }
});

test("screen_capture: a command that writes no file returns a clear error, not a crash", async () => {
  const prev = process.env.VISHU_SCREENSHOT_CMD;
  process.env.VISHU_SCREENSHOT_CMD = JSON.stringify(["node", "-e", NOOP_STUB, "{out}"]);
  const c = ctx();
  try {
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "desktop" }));
    assert.match(await c.tools.get("screen_capture").run({}, {} as never), /no file/);
  } finally {
    rmSync(c.workspaceDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.VISHU_SCREENSHOT_CMD;
    else process.env.VISHU_SCREENSHOT_CMD = prev;
  }
});
