import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "./config.js";

const base = { VISHU_PROVIDER: "openai" } as NodeJS.ProcessEnv;

test("env keys get default primary/backupN labels in order", () => {
  const cfg = loadConfig({ ...base, VISHU_API_KEYS: "k1, k2, k3" });
  assert.deepEqual(cfg.provider.apiKeys, ["k1", "k2", "k3"]);
  assert.deepEqual(cfg.provider.keyLabels, ["primary", "backup1", "backup2"]);
});

test("a single env key is labelled primary", () => {
  const cfg = loadConfig({ ...base, VISHU_API_KEY: "only" });
  assert.deepEqual(cfg.provider.keyLabels, ["primary"]);
});

test("file config keeps explicit labels and defaults the rest", () => {
  const cfgFile = join(mkdtempSync(join(tmpdir(), "vishu-cfg-")), "config.json");
  writeFileSync(
    cfgFile,
    JSON.stringify({ provider: { type: "openai", apiKeys: [{ key: "k1", label: "main-account" }, "k2"] } }),
  );
  const cfg = loadConfig({ VISHU_CONFIG: cfgFile } as NodeJS.ProcessEnv);
  assert.deepEqual(cfg.provider.apiKeys, ["k1", "k2"]);
  assert.deepEqual(cfg.provider.keyLabels, ["main-account", "backup1"]);
});

test("no keys yields empty arrays", () => {
  const cfg = loadConfig(base);
  assert.deepEqual(cfg.provider.apiKeys, []);
  assert.deepEqual(cfg.provider.keyLabels, []);
});

test("named providers + role assignments parse from the file", () => {
  const cfgFile = join(mkdtempSync(join(tmpdir(), "vishu-cfg-")), "config.json");
  writeFileSync(
    cfgFile,
    JSON.stringify({
      provider: { type: "mock" },
      providers: { fast: { type: "ollama", model: "llama3.2" }, smart: { type: "anthropic", apiKeys: ["k1"] } },
      roles: { builder: "fast", judge: "smart" },
    }),
  );
  const cfg = loadConfig({ VISHU_CONFIG: cfgFile } as NodeJS.ProcessEnv);
  assert.deepEqual(Object.keys(cfg.providers).sort(), ["fast", "smart"]);
  assert.equal(cfg.providers.fast.model, "llama3.2");
  assert.equal(cfg.providers.smart.keyLabels[0], "primary");
  assert.deepEqual(cfg.roles, { builder: "fast", judge: "smart" });
});

test("absent multi-provider config yields empty providers/roles", () => {
  const cfg = loadConfig(base);
  assert.deepEqual(cfg.providers, {});
  assert.deepEqual(cfg.roles, {});
});

test("preset: VISHU_PROVIDER=gemini → OpenAI adapter + Google endpoint + gemini model", () => {
  const cfg = loadConfig({ VISHU_PROVIDER: "gemini", VISHU_API_KEY: "k1" } as NodeJS.ProcessEnv);
  assert.equal(cfg.provider.type, "openai");
  assert.equal(cfg.provider.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(cfg.provider.model, "gemini-2.0-flash");
  assert.deepEqual(cfg.provider.apiKeys, ["k1"]);
});

test("auto-detect: a standard provider env var sets the provider + key(s) with no VISHU_PROVIDER", () => {
  const o = loadConfig({ OPENAI_API_KEY: "sk-abc" } as NodeJS.ProcessEnv);
  assert.equal(o.provider.type, "openai");
  assert.deepEqual(o.provider.apiKeys, ["sk-abc"]);

  const g = loadConfig({ GEMINI_API_KEY: "g-1,g-2" } as NodeJS.ProcessEnv);
  assert.equal(g.provider.type, "openai"); // gemini preset → openai adapter
  assert.equal(g.provider.model, "gemini-2.0-flash");
  assert.deepEqual(g.provider.apiKeys, ["g-1", "g-2"]); // N keys from the standard env var
});

test("precedence: explicit VISHU_API_KEY beats a standard env var", () => {
  const cfg = loadConfig({ VISHU_PROVIDER: "openai", VISHU_API_KEY: "explicit", OPENAI_API_KEY: "ignored" } as NodeJS.ProcessEnv);
  assert.deepEqual(cfg.provider.apiKeys, ["explicit"]);
});

test("auto-detect from key prefix: nvapi- → NVIDIA NIM, sk-ant- → anthropic", () => {
  const n = loadConfig({ VISHU_API_KEY: "nvapi-abc123" } as NodeJS.ProcessEnv);
  assert.equal(n.provider.type, "openai");
  assert.equal(n.provider.baseUrl, "https://integrate.api.nvidia.com/v1");
  assert.equal(n.provider.model, "meta/llama-3.1-8b-instruct");

  const a = loadConfig({ VISHU_API_KEY: "sk-ant-xyz" } as NodeJS.ProcessEnv);
  assert.equal(a.provider.type, "anthropic");

  // an explicit VISHU_API_KEY outranks a stray ambient provider env var (e.g. ANTHROPIC_API_KEY)
  const mixed = loadConfig({ VISHU_API_KEY: "nvapi-abc", ANTHROPIC_API_KEY: "sk-ant-ambient" } as NodeJS.ProcessEnv);
  assert.equal(mixed.provider.baseUrl, "https://integrate.api.nvidia.com/v1");
  assert.deepEqual(mixed.provider.apiKeys, ["nvapi-abc"]);
});

test("extended providers: prefix + preset for xai, fireworks, perplexity, and env-named mistral", () => {
  assert.equal(loadConfig({ VISHU_API_KEY: "xai-abc" } as NodeJS.ProcessEnv).provider.baseUrl, "https://api.x.ai/v1");
  assert.equal(loadConfig({ VISHU_API_KEY: "fw_abc" } as NodeJS.ProcessEnv).provider.baseUrl, "https://api.fireworks.ai/inference/v1");
  assert.equal(loadConfig({ VISHU_API_KEY: "pplx-abc" } as NodeJS.ProcessEnv).provider.model, "sonar");
  assert.equal(loadConfig({ MISTRAL_API_KEY: "abc" } as NodeJS.ProcessEnv).provider.baseUrl, "https://api.mistral.ai/v1");
});
