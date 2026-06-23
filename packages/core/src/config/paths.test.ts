import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePaths } from "./paths.js";

test("defaults derive from home + userId", () => {
  const p = resolvePaths({ VISHU_HOME: "/home/x", VISHU_USER_ID: "alice" });
  assert.match(p.actionDir, /Vishu[\\/]projects$/);
  assert.match(p.workspaceDir, /users[\\/]alice[\\/]workspace$/);
  assert.match(p.vaultDir, /Vishu[\\/]vault$/);
  assert.match(p.memoryDbFile, /users[\\/]alice[\\/]memory\.db$/);
  assert.equal(p.userId, "alice");
});

test("explicit env overrides win", () => {
  const p = resolvePaths({
    VISHU_HOME: "/home/x",
    VISHU_ACTION_DIR: "/srv/actions",
    VISHU_WORKSPACE_DIR: "/srv/ws",
  });
  assert.match(p.actionDir, /srv[\\/]actions$/);
  assert.match(p.workspaceDir, /srv[\\/]ws$/);
});
