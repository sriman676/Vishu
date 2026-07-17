import assert from "node:assert/strict";
import { test } from "node:test";
import type { Router } from "../providers/router.js";
import { fastLaneRoles } from "./roles.js";

test("fastLaneRoles routes cheap roles to a local lane when configured, else falls back to main", () => {
  const main = { name: "main" } as unknown as Router;
  const mainModel = "meta/llama-3.1-70b-instruct";

  const off = fastLaneRoles(main, mainModel, {});
  assert.equal(off.for("fast"), main, "no local endpoint → fast falls back to main");
  assert.equal(off.modelFor("fast"), mainModel);

  const on = fastLaneRoles(main, mainModel, { VISHU_LOCAL_BASE_URL: "http://127.0.0.1:11434", VISHU_LOCAL_MODEL: "llama3.1:8b" });
  assert.notEqual(on.for("summariser"), main, "cheap role routed off the main router");
  assert.equal(on.modelFor("summariser"), "llama3.1:8b", "pinned to the local model");
  assert.equal(on.for("main"), main, "reasoning stays on main");
  assert.equal(on.modelFor("reasoner"), mainModel, "an unlisted role uses the main model");
});
