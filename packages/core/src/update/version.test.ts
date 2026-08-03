import assert from "node:assert/strict";
import { test } from "node:test";
import { checkUpdate, isNewer, updateStatus } from "./version.js";

test("isNewer compares dotted numeric versions", () => {
  assert.equal(isNewer("0.0.0", "0.1.0"), true);
  assert.equal(isNewer("1.2.3", "1.2.4"), true);
  assert.equal(isNewer("v1.0.0", "1.0.0"), false, "equal (v-prefix ignored)");
  assert.equal(isNewer("2.0.0", "1.9.9"), false, "older is not newer");
  assert.equal(isNewer("1.0", "1.0.1"), true, "ragged lengths");
});

test("updateStatus + checkUpdate flag an available update", async () => {
  assert.deepEqual(updateStatus("0.0.0", { version: "0.2.0" }), { current: "0.0.0", latest: "0.2.0", updateAvailable: true });
  const fakeFetch = (async () => new Response(JSON.stringify({ version: "0.3.0" }), { status: 200 })) as unknown as typeof fetch;
  assert.equal((await checkUpdate("http://x/latest.json", "0.1.0", fakeFetch)).updateAvailable, true);
});
