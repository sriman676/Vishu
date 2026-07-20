import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assignRoles, discoverProviders } from "./registry.js";

/** A clean env with only the given keys — avoids leaking the real shell's provider keys into a test. */
function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

test("discovers only providers whose key is present", () => {
  const list = discoverProviders(env({ GROQ_API_KEY: "gsk_x", MINIMAX_API_KEY: "mm_x" }));
  const names = list.map((p) => p.name);
  assert.deepEqual(new Set(names), new Set(["groq", "minimax"]));
  assert.equal(list.length, 2);
});

test("a newly pasted key just works — appears in the pool", () => {
  const before = discoverProviders(env({ GROQ_API_KEY: "gsk_x" })).map((p) => p.name);
  assert.deepEqual(before, ["groq"]);
  const after = discoverProviders(env({ GROQ_API_KEY: "gsk_x", MINIMAX_API_KEY: "mm_x" })).map((p) => p.name);
  assert.ok(after.includes("minimax"), "minimax joins the pool once its key is present");
});

test("ranked best-first: premium outranks cheap", () => {
  const list = discoverProviders(env({ MINIMAX_API_KEY: "mm", GROQ_API_KEY: "gsk" }));
  assert.equal(list[0].name, "minimax"); // premium
  assert.equal(list[0].tier, "premium");
  assert.equal(list[1].name, "groq"); // cheap
});

test("NVIDIA folds spare NIM keys into one provider as failover endpoints", () => {
  const list = discoverProviders(env({ NVIDIA_API_KEY: "nvapi-a", NIM_API_KEY_FRIEND_1: "nvapi-b", NIM_API_KEY_STRIX: "nvapi-c" }));
  const nvidia = list.find((p) => p.name === "nvidia");
  assert.ok(nvidia);
  assert.equal(nvidia.keyCount, 3);
  assert.equal(nvidia.cfg.apiKeys.length, 3);
});

test("local endpoint joins as its own tier when configured", () => {
  const list = discoverProviders(env({ VISHU_LOCAL_BASE_URL: "http://127.0.0.1:11434", VISHU_LOCAL_MODEL: "qwen3:8b" }));
  const local = list.find((p) => p.name === "local");
  assert.ok(local);
  assert.equal(local.tier, "local");
  assert.equal(local.cfg.type, "ollama");
});

test("assignRoles: hard roles → best premium, fast roles → best cheap", () => {
  const list = discoverProviders(env({ MINIMAX_API_KEY: "mm", GROQ_API_KEY: "gsk" }));
  const roles = assignRoles(list);
  assert.equal(roles.brain, "minimax");
  assert.equal(roles.builder, "minimax");
  assert.equal(roles.fast, "groq");
  assert.equal(roles.classifier, "groq");
});

test("assignRoles: with no premium, hard roles fall back to best cheap", () => {
  const roles = assignRoles(discoverProviders(env({ GROQ_API_KEY: "gsk" })));
  assert.equal(roles.brain, "groq");
  assert.equal(roles.fast, "groq");
});

test("a probe-marked-dead provider is dropped from discovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-health-"));
  const health = join(dir, "keys-health.json");
  writeFileSync(health, JSON.stringify({ providers: { anthropic: { ok: false }, groq: { ok: true } } }));
  const list = discoverProviders(env({ ANTHROPIC_API_KEY: "sk-ant", GROQ_API_KEY: "gsk", VISHU_KEYS_HEALTH: health }));
  const names = list.map((p) => p.name);
  assert.ok(!names.includes("anthropic"), "dead provider dropped");
  assert.ok(names.includes("groq"), "live provider kept");
});
