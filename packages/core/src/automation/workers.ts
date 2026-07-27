import { rollupSession, selfHealMemory } from "../memory/rollup.js";
import type { MemoryStore } from "../memory/store.js";
import { withHeavy } from "../reliability/heavy.js";

/** A background maintenance task with a human-readable one-line result. */
export interface MaintenanceWorker {
  name: string;
  run(): Promise<string>;
}

/** The three memory-maintenance workers, all reusing existing memory ops (nothing new to maintain):
 * janitor self-heals (prune superseded + auto-resolve contradictions), distiller rolls the vault into a
 * token-cheap session summary, curator sweeps tier TTLs (expire ingest, archive stale). */
export function memoryWorkers(store: MemoryStore): MaintenanceWorker[] {
  return [
    {
      name: "janitor",
      run: async () => {
        const r = selfHealMemory(store, { resolveConflicts: true });
        return `pruned ${r.pruned.length}, resolved ${r.resolved.length}, conflicts ${r.conflicts.length}, broken ${r.brokenLinks.length}, orphans ${r.orphans.length}`;
      },
    },
    {
      name: "distiller",
      run: async () => `rollup ${(await rollupSession(store)).name}`,
    },
    {
      name: "curator",
      run: async () => {
        const r = store.sweepTiers();
        return `expired ${r.expired.length}, archived ${r.archived.length}`;
      },
    },
  ];
}

/** Run each worker under the heavy semaphore, one at a time. A throwing worker is captured as
 * "error: <msg>" so a single failure can't take down the batch — the rest still run. */
export async function runWorkers(
  workers: MaintenanceWorker[],
  log?: (line: string) => void,
): Promise<{ name: string; summary: string }[]> {
  const results: { name: string; summary: string }[] = [];
  for (const w of workers) {
    let summary: string;
    try {
      summary = await withHeavy(() => w.run());
    } catch (e) {
      summary = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
    log?.(`[worker:${w.name}] ${summary}`);
    results.push({ name: w.name, summary });
  }
  return results;
}
