import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EchoProvider, ScriptedProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import { makePolicy } from "../security/policy.js";
import { registerBuiltins } from "../tools/builtins.js";
import { ToolRegistry } from "../tools/registry.js";
import { buildApp, chunkValidator, harden, specVerify, writeBuildArtifacts } from "./build.js";
import { maintainabilityGate } from "./gate.js";
import { hasBlockers, scanDir } from "./security.js";
import { interviewStep, specToMarkdown } from "./spec.js";

test("security scan: catches a planted SQL-injection and a hardcoded secret, spares parameterized queries", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-scan-"));
  writeFileSync(
    join(dir, "db.js"),
    [
      'const apiKey = "sk-abcdef123456";', // hardcoded secret
      'function find(userId) { return db.query("SELECT * FROM users WHERE id = " + userId); }', // SQLi
      'function safe(userId) { return db.query("SELECT * FROM users WHERE id = ?", [userId]); }', // parameterized — clean
    ].join("\n"),
  );
  const findings = scanDir(dir);
  const rules = findings.map((f) => f.rule);
  assert.ok(rules.includes("hardcoded-secret"), "secret caught");
  assert.ok(rules.includes("sql-injection"), "SQLi caught");
  assert.equal(rules.filter((r) => r === "sql-injection").length, 1, "parameterized query not flagged");
  assert.equal(hasBlockers(findings), true);
});

test("interview: returns clarifying questions, then parses a complete spec", async () => {
  const router = new Router([
    new ScriptedProvider([
      { content: "Q: Who are the users?\nQ: What data is stored?", finish: "stop" },
      { content: 'SPEC: {"name":"todo","goal":"a todo app","pages":["list"],"dataModel":["Task"],"flows":["add task"],"constraints":["local-only"]}', finish: "stop" },
    ]),
  ]);
  const q = await interviewStep(router, "mock", "a todo app", []);
  assert.equal(q.kind, "questions");
  assert.deepEqual(q.kind === "questions" && q.questions, ["Who are the users?", "What data is stored?"]);

  const done = await interviewStep(router, "mock", "a todo app", [{ q: "Who are the users?", a: "just me" }]);
  assert.equal(done.kind, "spec");
  if (done.kind === "spec") {
    assert.equal(done.spec.name, "todo");
    assert.deepEqual(done.spec.dataModel, ["Task"]);
    assert.match(specToMarkdown(done.spec), /## Data model\n- Task/);
  }
});

test("maintainability gate: flags missing tests, passes a tested project", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-gate-"));
  writeFileSync(join(dir, "app.js"), "export const add = (a, b) => a + b;\n");
  assert.equal(maintainabilityGate(dir).ok, false); // no tests

  writeFileSync(join(dir, "app.test.js"), "import { add } from './app.js';\nadd(1, 2);\n");
  assert.equal(maintainabilityGate(dir).ok, true);

  assert.equal(maintainabilityGate(mkdtempSync(join(tmpdir(), "vishu-empty-"))).ok, false); // no source
});

test("specVerify: grounded PASS/FAIL verdict on the produced code", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-verify-"));
  writeFileSync(join(dir, "home.js"), "export const home = () => 'hi';\n");
  const spec = { name: "x", goal: "g", pages: ["home"], dataModel: [], flows: [], constraints: [] };
  const pass = new Router([new ScriptedProvider([{ content: "PASS", finish: "stop" }])]);
  const fail = new Router([new ScriptedProvider([{ content: "FAIL: missing the list page", finish: "stop" }])]);
  assert.equal((await specVerify(pass, "mock", spec, "home page", dir)).ok, true);
  const v = await specVerify(fail, "mock", spec, "home page", dir);
  assert.equal(v.ok, false);
  assert.match(v.output, /missing/);
});

test("chunk validator: blocks a vuln chunk, passes clean code that satisfies the spec", async () => {
  const spec = { name: "x", goal: "g", pages: ["home"], dataModel: [], flows: [], constraints: [] };
  const deps = { router: new Router([new ScriptedProvider([{ content: "PASS", finish: "stop" }])]), model: "mock", policy: makePolicy("full", "."), registry: new ToolRegistry(), repoDir: "." };

  const vulnDir = mkdtempSync(join(tmpdir(), "vishu-cv-vuln-"));
  writeFileSync(join(vulnDir, "db.js"), 'const apiKey = "sk-abcdef123456";\n');
  const blocked = await chunkValidator(deps, spec, "data layer")(vulnDir);
  assert.equal(blocked.ok, false); // security blocks before spec verify even runs
  assert.match(blocked.output, /security/);

  const cleanDir = mkdtempSync(join(tmpdir(), "vishu-cv-clean-"));
  writeFileSync(join(cleanDir, "home.js"), "export const home = () => 'hi';\n");
  assert.equal((await chunkValidator(deps, spec, "home page")(cleanDir)).ok, true); // clean → spec verify PASS
});

test("harden: a planted blocking vuln is caught and remediated before done", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "vishu-harden-"));
  const vuln = join(repoDir, "leak.js");
  writeFileSync(vuln, 'const password = "supersecret123";\n'); // blocking finding

  const deps = {
    router: new Router([new EchoProvider()]),
    model: "mock",
    policy: makePolicy("full", repoDir),
    registry: registerBuiltins(new ToolRegistry()),
    repoDir,
  };
  assert.equal(hasBlockers(scanDir(repoDir)), true); // present before harden

  const res = await harden(deps, {
    // stand in for the remediation subagent: remove the leaked credential in the worktree.
    fix: async (wt) => {
      rmSync(join(wt, "leak.js"));
      return { ok: true, output: "removed secret" };
    },
  });
  assert.equal(res.remediations, 1);
  assert.equal(hasBlockers(res.findings), false); // fixed: no blockers remain in the merged repo
});

test("buildApp: spec → chunked build → clean security + gate → ok report", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "vishu-build-"));
  const router = new Router([
    new ScriptedProvider([
      { content: "the only page", finish: "stop" }, // decompose → one chunk
      { content: "built the page", finish: "stop" }, // chunk coder turn (no tool calls → loop ends)
      { content: "none", finish: "stop" }, // advisory llmReview pass
    ]),
  ]);
  const spec = { name: "mini", goal: "a mini app", pages: ["home"], dataModel: ["Item"], flows: ["view"], constraints: [] };

  const report = await buildApp(
    { router, model: "mock", policy: makePolicy("full", repoDir), registry: registerBuiltins(new ToolRegistry()), repoDir },
    spec,
    {
      // stand in for the coder writing files: drop clean source + a test so security + gate pass.
      chunkValidate: async (wt) => {
        writeFileSync(join(wt, "home.js"), "export const home = () => 'hello';\n");
        writeFileSync(join(wt, "home.test.js"), "import { home } from './home.js';\nhome();\n");
        return { ok: true, output: "built" };
      },
    },
  );

  assert.equal(report.ok, true);
  assert.equal(report.chunks.length, 1);
  assert.equal(report.chunks[0]?.ok, true);
  assert.equal(hasBlockers(report.findings), false);
  assert.equal(report.gate.ok, true);

  // the build promises a written ARCHITECTURE doc + PENTEST report beside the app — prove they land.
  const { architecture, pentest } = writeBuildArtifacts(repoDir, report);
  assert.match(readFileSync(architecture, "utf8"), /# Spec: mini/);
  const pen = readFileSync(pentest, "utf8");
  assert.match(pen, /# Pentest report: mini/);
  assert.match(pen, /\*\*Verdict:\*\* PASS/);
});
