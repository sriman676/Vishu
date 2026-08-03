import assert from "node:assert/strict";
import { test } from "node:test";
import { bench } from "./ratelimit-bench.js";

test("key-ring absorbs a burst that stalls a single client", async () => {
  const r = await bench(40, 10, 3); // 40 calls, 4 keys × capacity 10 = 40 headroom
  assert.equal(r.singleClient, 10, "one key completes only its capacity, the rest 429");
  assert.equal(r.failover, 40, "failover rotates off each 429 through the ring — all complete");
  assert.equal(r.balance, 40, "balance spreads the burst across the ring — all complete");
  assert.ok(r.failover > r.singleClient, "the ring is the structural throughput win");
});
