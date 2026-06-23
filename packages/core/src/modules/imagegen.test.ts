import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ToolRegistry } from "../tools/registry.js";
import { EventBus } from "../transport/events.js";
import { Registry } from "../transport/rpc.js";
import { MODULES } from "./all.js";
import { enabledModules, loadModules } from "./registry.js";

function ctx() {
  const workspaceDir = mkdtempSync(join(tmpdir(), "vishu-img-"));
  const c = { tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir };
  return c;
}

test("imagegen: writes a PNG, returns its path, and never echoes the key", async () => {
  const prevKey = process.env.VISHU_IMAGE_API_KEY;
  process.env.VISHU_IMAGE_API_KEY = "sk-secret-123";
  const realFetch = globalThis.fetch;
  const c = ctx();
  try {
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "imagegen" }));
    const b64 = Buffer.from("PNGDATA").toString("base64");
    let auth: string | undefined;
    globalThis.fetch = (async (_url: string, init: any) => {
      auth = init.headers.authorization;
      return { json: async () => ({ data: [{ b64_json: b64 }] }) };
    }) as never;

    const out = await c.tools.get("image_generate").run({ prompt: "a cat", name: "cat" }, {} as never);
    assert.ok(existsSync(out), `expected file at ${out}`);
    assert.equal(readFileSync(out, "utf8"), "PNGDATA");
    assert.ok(out.endsWith(".png"));
    assert.ok(!out.includes("sk-secret"));
    assert.equal(auth, "Bearer sk-secret-123"); // key goes to provider, not into the result

    // provider error surfaces, doesn't crash
    globalThis.fetch = (async () => ({ json: async () => ({ error: { message: "rate limited" } }) })) as never;
    assert.match(await c.tools.get("image_generate").run({ prompt: "x" }, {} as never), /rate limited/);
  } finally {
    globalThis.fetch = realFetch;
    rmSync(c.workspaceDir, { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.VISHU_IMAGE_API_KEY;
    else process.env.VISHU_IMAGE_API_KEY = prevKey;
  }
});

test("imagegen: unconfigured returns a clear error, not a crash", async () => {
  const prevKey = process.env.VISHU_IMAGE_API_KEY;
  delete process.env.VISHU_IMAGE_API_KEY;
  const c = ctx();
  try {
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "imagegen" }));
    assert.match(await c.tools.get("image_generate").run({ prompt: "x" }, {} as never), /VISHU_IMAGE_API_KEY/);
  } finally {
    rmSync(c.workspaceDir, { recursive: true, force: true });
    if (prevKey !== undefined) process.env.VISHU_IMAGE_API_KEY = prevKey;
  }
});
