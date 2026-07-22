import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { VishuPaths } from "../config/paths.js";
import { activity, dataMap, snapshot } from "./dashboard.js";

function fixture(): VishuPaths {
  const home = mkdtempSync(join(tmpdir(), "vishu-dash-"));
  const ws = join(home, "workspace");
  const paths: VishuPaths = {
    userId: "test",
    actionDir: join(home, "projects"),
    workspaceDir: ws,
    configFile: join(home, "config.json"),
    skillsDir: join(home, "skills"),
    vaultDir: join(home, "vault"),
    memoryDbFile: join(home, "memory.db"),
  };
  mkdirSync(ws, { recursive: true });
  writeFileSync(paths.configFile, "{}");
  // usage.jsonl: ts is a NUMBER; two calls (one cloud, one local-free)
  writeFileSync(
    join(ws, "usage.jsonl"),
    `${JSON.stringify({ ts: 1000, model: "gpt-4o", category: "chat", promptTokens: 100, completionTokens: 50 })}\n` +
      `${JSON.stringify({ ts: 3000, model: "qwen2.5:7b", category: "classify", promptTokens: 10, completionTokens: 5 })}\n`,
  );
  // decisions.jsonl: ts is an ISO STRING
  writeFileSync(
    join(ws, "decisions.jsonl"),
    `${JSON.stringify({ ts: new Date(2000).toISOString(), kind: "gate", tool: "shell", action: "write", verdict: "deny", reason: "x" })}\n`,
  );
  // memory-events.log: RunLog {ts ISO, kind, detail}
  writeFileSync(
    join(ws, "memory-events.log"),
    `${JSON.stringify({ ts: new Date(4000).toISOString(), kind: "branch_start", detail: "research" })}\n`,
  );
  return paths;
}

test("dataMap lists known store nodes with holds + never a secret path", () => {
  const nodes = dataMap(fixture());
  const labels = nodes.map((n) => n.label);
  assert.ok(labels.includes("Memory vault"));
  assert.ok(labels.includes("usage.jsonl"));
  assert.ok(nodes.every((n) => n.holds.length > 0));
  // F11: nothing secret-looking is ever listed
  assert.ok(nodes.every((n) => !/\.env|credential|secret|token|\.key$|cookies/i.test(n.path)));
  // config exists → modified set; a not-yet-created store → exists:false, still listed
  assert.equal(nodes.find((n) => n.label === "Config")?.exists, true);
});

test("activity merges the three logs, newest first, normalizing number+ISO ts", () => {
  const ev = activity(fixture().workspaceDir);
  assert.equal(ev.length, 4);
  assert.deepEqual(
    ev.map((e) => e.ts),
    [4000, 3000, 2000, 1000],
  );
  assert.equal(ev[0].source, "memory");
  assert.match(ev.find((e) => e.source === "gate")!.text, /gate deny: shell write/);
  // cloud model call shows cost; local model does not
  assert.match(ev.find((e) => e.text.includes("gpt-4o"))!.text, /\$/);
  assert.doesNotMatch(ev.find((e) => e.text.includes("qwen"))!.text, /\$/);
});

test("snapshot returns both panels; missing logs → empty feed, no throw", () => {
  const paths = fixture();
  const snap = snapshot(paths);
  assert.ok(snap.dataMap.length > 0);
  assert.equal(snap.activity.length, 4);
  // a fresh workspace with no logs must not throw
  const empty = snapshot({ ...paths, workspaceDir: join(paths.workspaceDir, "nope") });
  assert.deepEqual(empty.activity, []);
});
