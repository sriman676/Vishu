import assert from "node:assert/strict";
import { test } from "node:test";
import { authPlan } from "./composio-auth.js";

test("authPlan gates the keyless-connect OAuth launch", () => {
  assert.equal(authPlan("gmail", false, true, {}).run, false, "no --auth → skip");
  assert.equal(authPlan("github", true, false, { COMPOSIO_API_KEY: "k" }).run, false, "direct-mount app → skip");
  const noKey = authPlan("gmail", true, true, {});
  assert.equal(noKey.run, false, "no key → skip");
  assert.match(noKey.note, /COMPOSIO_API_KEY/, "and tell the user how to fix it");
  assert.equal(authPlan("gmail", true, true, { COMPOSIO_API_KEY: "k" }).run, true, "composio route + --auth + key → launch");
});
