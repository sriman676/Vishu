import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveConnect } from "./domains.js";

test("a curated app resolves to its own MCP", () => {
  const r = resolveConnect("browser");
  assert.equal(r.via, "known");
  assert.equal(r.cfg.id, "browser");
});

test("an unknown app name resolves to the universal Composio mount (no error, no per-app package)", () => {
  const r = resolveConnect("notion");
  assert.equal(r.via, "composio");
  assert.equal(r.cfg.id, "composio");
  assert.equal(r.cfg.requireEnv, "COMPOSIO_API_KEY");
});
