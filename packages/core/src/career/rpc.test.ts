import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "../transport/rpc.js";
import { AchievementStore } from "./achievements.js";
import { registerCareer } from "./rpc.js";

function setup() {
  const achievements = new AchievementStore(join(mkdtempSync(join(tmpdir(), "career-")), "a.json"));
  const registry = new Registry();
  registerCareer(registry, { achievements, buildResume: (pj) => `# Resume\nprojects:${pj ?? "none"}` });
  return { registry, achievements };
}

async function call(registry: Registry, method: string, params: unknown) {
  const res = await registry.handle({ jsonrpc: "2.0", id: 1, method, params });
  return res.result as { ok: boolean; result?: unknown; error?: unknown };
}

test("career RPC: add + list achievements, and skip duplicates", async () => {
  const { registry } = setup();
  assert.equal((await call(registry, "vishu.career_achievement_add", { text: "Shipped X #api" })).ok, true);
  assert.equal((await call(registry, "vishu.career_achievement_add", { text: "Shipped X #api" })).ok, false); // dup
  assert.equal((await call(registry, "vishu.career_achievement_add", {})).ok, false); // missing text

  const list = await call(registry, "vishu.career_achievements", {});
  assert.equal(list.ok, true);
  assert.equal((list.result as { items: unknown[] }).items.length, 1);
});

test("career RPC: resume assembles, projectsJson threads through", async () => {
  const { registry } = setup();
  const r = await call(registry, "vishu.career_resume", { projectsJson: "[]" });
  assert.equal(r.ok, true);
  assert.match((r.result as { markdown: string }).markdown, /projects:\[\]/);
});
