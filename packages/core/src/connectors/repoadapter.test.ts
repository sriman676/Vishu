import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { makePolicy } from "../security/policy.js";
import { Terminal } from "../tools/terminal.js";
import { ToolRegistry } from "../tools/registry.js";
import { loadRepoAdapters, registerAdapterTools, toDomainConfigs } from "./repoadapter.js";

function integrations(): string {
  const root = mkdtempSync(join(tmpdir(), "vishu-integ-"));
  const mk = (name: string, adapter: unknown, extra?: (dir: string) => void) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "jarvis-adapter.json"), JSON.stringify(adapter));
    extra?.(dir);
  };
  mk("careerops", { id: "careerops", kind: "mcp", cmd: ".venv/Scripts/python.exe", args: ["-m", "server"], actions: { apply: "send", "*": "read" } });
  mk("notes", { id: "notes", kind: "data", tools: [{ name: "readme", path: "README.md", description: "the repo readme" }] }, (dir) => writeFileSync(join(dir, "README.md"), "hello from the repo"));
  mk("echo", { id: "echo", kind: "cli", cmd: process.execPath, tools: [{ name: "ver", args: ["--version"], description: "node version" }] });
  mk("broken", "{ not json", () => {}); // malformed → skipped, must not abort discovery
  return root;
}

test("loadRepoAdapters: discovers valid adapters, skips a malformed one, resolves data paths", () => {
  const adapters = loadRepoAdapters(integrations());
  const ids = adapters.map((a) => a.id).sort();
  assert.deepEqual(ids, ["careerops", "echo", "notes"]); // "broken" dropped, no throw
  const data = adapters.find((a) => a.id === "notes");
  assert.ok(data?.kind === "data" && data.tools[0]!.path.endsWith("README.md"));
});

test("loadRepoAdapters: a missing integrations dir is empty, not an error", () => {
  assert.deepEqual(loadRepoAdapters(join(tmpdir(), "vishu-nope-does-not-exist")), []);
});

test("toDomainConfigs: only MCP adapters become DomainConfigs (CLI/data excluded)", () => {
  const cfgs = toDomainConfigs(loadRepoAdapters(integrations()));
  assert.equal(cfgs.length, 1);
  assert.equal(cfgs[0]!.id, "careerops");
  assert.equal(cfgs[0]!.actions?.apply, "send");
  assert.ok(!("kind" in cfgs[0]!)); // kind stripped — it's a plain DomainConfig now
});

test("registerAdapterTools: CLI + data become namespaced tools; data reads the file, action classes apply", async () => {
  const registry = new ToolRegistry();
  const names = registerAdapterTools(registry, loadRepoAdapters(integrations()));
  assert.ok(names.includes("notes__readme"));
  assert.ok(names.includes("echo__ver"));
  assert.ok(!names.some((n) => n.startsWith("careerops__")), "MCP adapter not registered here (DomainManager owns it)");

  const ctx = { policy: makePolicy("full", tmpdir()), terminal: new Terminal(tmpdir()) };
  const out = await registry.get("notes__readme")!.run({}, ctx);
  assert.match(out, /hello from the repo/);
  assert.equal(registry.get("notes__readme")!.meta?.action, "read");

  // CLI tool runs a no-shell args-array command and returns its output.
  const ver = await registry.get("echo__ver")!.run({}, ctx);
  assert.match(ver, /v\d+\.\d+/); // node --version like v20.x
});
