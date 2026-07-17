// CF4 live E2E: drive the supervised swarm (Coordinator) on a tiny real multi-file goal
// through NIM. Proves the pipeline end-to-end: fan-out → per-branch build in an isolated
// git worktree → validate by running tests → harvest the winner → surface the merged diff.
// Run: npx tsx scripts/verify-cf4-nim.mts   (loads the NIM key from ../../.env → VISHU_API_KEY)
// Cheap by design: 2 branches, one small 2-file goal. Override the model with CF4_MODEL.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/config.js";
import { buildRouter } from "../src/providers/factory.js";
import { Coordinator } from "../src/orchestration/coordinator.js";
import { ensureRepo, mergedDiffStat } from "../src/orchestration/subagent.js";
import { registerBuiltins } from "../src/tools/builtins.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { makePolicy } from "../src/security/policy.js";

process.loadEnvFile(join(import.meta.dirname, "..", "..", "..", ".env")); // project vishu/.env
const cfg = loadConfig();
if (cfg.provider.type !== "openai" || !/nvidia|nim/i.test(cfg.provider.baseUrl) || cfg.provider.apiKeys.length === 0) {
  throw new Error(`[cf4] expected a NIM (nvidia openai-compatible) provider with a key, got ${cfg.provider.type} @ ${cfg.provider.baseUrl} (${cfg.provider.apiKeys.length} key)`);
}
const model = process.env.CF4_MODEL || "meta/llama-3.1-70b-instruct"; // moderate NIM builder; keep the goal tiny
console.log(`[cf4] provider=${cfg.provider.type} base=${cfg.provider.baseUrl} model=${model}`);

const repoDir = mkdtempSync(join(tmpdir(), "vishu-cf4-"));
ensureRepo(repoDir);
const registry = registerBuiltins(new ToolRegistry());
const coordinator = new Coordinator({
  router: buildRouter(cfg.provider),
  model,
  parentPolicy: makePolicy("full", repoDir),
  parentRegistry: registry,
  repoDir,
  ask: async () => true, // supervised: approve subagents' gated actions in this sandbox
});

const goal =
  "Use the write_file tool to create exactly two files in the current directory (do not use shell echo/tee). " +
  "File greet.mjs must contain exactly: export const greet = (name) => `hi ${name}`; . " +
  "File greet.test.mjs must be pure ESM (use import, never require) with exactly these lines: " +
  "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { greet } from './greet.mjs'; " +
  "test('greet', () => assert.equal(greet('x'), 'hi x')); . " +
  "Do not create any other files.";
const validateCommand = "node --test greet.test.mjs";

console.log(`[cf4] sandbox=${repoDir}\n[cf4] running orchestrate (3 branches)…`);
const result = await coordinator.run(goal, { maxBranches: 3, validateCommand });

console.log(`\n[cf4] ok=${result.ok} chosen=${result.chosen ?? "-"} merged=${result.merged}`);
for (const b of result.branches) {
  console.log(`  branch ok=${b.ok} :: ${b.hypothesis.slice(0, 70)}`);
  console.log(`    final: ${b.final.slice(0, 160).replace(/\n/g, " ")}`);
  console.log(`    validate: ${b.output.slice(0, 200).replace(/\n/g, " ")}`);
}
if (result.merged) console.log(`\n[cf4] merged diff (what landed in the sandbox):\n${mergedDiffStat(repoDir)}`);

const pass = result.ok && result.merged;
console.log(`\n[cf4] ${pass ? "PASS" : "FAIL"} — winner's tests passed + merged diff surfaced: ${pass}`);
process.exit(pass ? 0 : 1);
