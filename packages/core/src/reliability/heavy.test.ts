import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { maxHeavy, withHeavy } from "./heavy.js";

afterEach(() => {
  delete process.env.JARVIS_MAX_HEAVY;
});

test("maxHeavy: defaults to 1, honours a valid JARVIS_MAX_HEAVY, ignores junk", () => {
  assert.equal(maxHeavy({} as NodeJS.ProcessEnv), 1);
  assert.equal(maxHeavy({ JARVIS_MAX_HEAVY: "3" } as unknown as NodeJS.ProcessEnv), 3);
  assert.equal(maxHeavy({ JARVIS_MAX_HEAVY: "0" } as unknown as NodeJS.ProcessEnv), 1);
  assert.equal(maxHeavy({ JARVIS_MAX_HEAVY: "nope" } as unknown as NodeJS.ProcessEnv), 1);
});

/** Track how many jobs are inside `withHeavy` at once; the peak must never exceed the cap. */
async function runJobs(count: number): Promise<number> {
  let active = 0;
  let peak = 0;
  const job = () =>
    withHeavy(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    });
  await Promise.all(Array.from({ length: count }, job));
  return peak;
}

test("withHeavy: default cap serialises heavy work (peak concurrency 1)", async () => {
  assert.equal(await runJobs(4), 1);
});

test("withHeavy: JARVIS_MAX_HEAVY=2 allows two at once, not three", async () => {
  process.env.JARVIS_MAX_HEAVY = "2";
  assert.equal(await runJobs(5), 2);
});

test("withHeavy: releases the slot even when fn throws", async () => {
  await assert.rejects(withHeavy(async () => { throw new Error("boom"); }), /boom/);
  // If the slot leaked, this second job would deadlock; a fast resolve proves the slot freed.
  assert.equal(await withHeavy(async () => 42), 42);
});
