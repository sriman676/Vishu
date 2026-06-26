import assert from "node:assert/strict";
import { test } from "node:test";
import { parallelMap } from "./parallel.js";

test("parallelMap keeps input order and respects the concurrency limit", async () => {
  let inflight = 0;
  let maxInflight = 0;
  const delays = [10, 5, 1, 8, 3]; // varied so faster items would finish out of order
  const out = await parallelMap(
    delays,
    async (ms, i) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, ms));
      inflight -= 1;
      return i;
    },
    2,
  );
  assert.deepEqual(out, [0, 1, 2, 3, 4], "results stay in input order");
  assert.ok(maxInflight <= 2, `never exceeds the limit (saw ${maxInflight})`);
  assert.equal(maxInflight, 2, "actually overlaps work (ran in parallel)");
});

test("parallelMap handles an empty list", async () => {
  assert.deepEqual(await parallelMap([], async () => 1, 4), []);
});
