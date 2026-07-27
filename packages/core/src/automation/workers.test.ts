import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryStore } from "../memory/store.js";
import { memoryWorkers, runWorkers, type MaintenanceWorker } from "./workers.js";

function store() {
  const dir = mkdtempSync(join(tmpdir(), "vishu-workers-"));
  return new MemoryStore(join(dir, "vault"), join(dir, "memory.db"));
}

test("all three memory workers run and return summaries", async () => {
  const s = store();
  await s.put({ content: "The user's name is Vishnu.", subject: "user-name" });
  const results = await runWorkers(memoryWorkers(s));
  s.close();

  assert.deepEqual(
    results.map((r) => r.name),
    ["janitor", "distiller", "curator"],
  );
  for (const r of results) assert.ok(r.summary.length > 0 && !r.summary.startsWith("error:"), r.name);
});

test("a throwing worker is isolated; the others still run", async () => {
  const workers: MaintenanceWorker[] = [
    { name: "ok-before", run: async () => "did a thing" },
    {
      name: "boom",
      run: async () => {
        throw new Error("kaboom");
      },
    },
    { name: "ok-after", run: async () => "did another" },
  ];
  const lines: string[] = [];
  const results = await runWorkers(workers, (l) => lines.push(l));

  assert.equal(results[0].summary, "did a thing");
  assert.equal(results[1].summary, "error: kaboom");
  assert.equal(results[2].summary, "did another");
  assert.equal(lines.length, 3);
});
