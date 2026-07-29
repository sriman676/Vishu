import { memoryWorkers, runWorkers } from "../automation/workers.js";
import { err, ok, type Registry } from "../transport/rpc.js";
import { rollupSession, selfHealMemory } from "./rollup.js";
import type { MemoryStore } from "./store.js";

/** Expose memory over `vishu.memory_*` (see docs/17 RPC catalog). */
export function registerMemory(registry: Registry, store: MemoryStore): void {
  registry.register("vishu.memory_doc_put", async (params) => {
    const p = (params ?? {}) as { content?: string; subject?: string; type?: string };
    if (!p.content) return err("invalid_params", "content is required");
    return ok(await store.put({ content: p.content, subject: p.subject, type: p.type }));
  });

  registry.register("vishu.memory_recall_memories", async (params) => {
    const p = (params ?? {}) as { query?: string; limit?: number; folder?: string };
    if (!p.query) return err("invalid_params", "query is required");
    return ok(await store.recall(p.query, { limit: p.limit, folder: p.folder }));
  });

  registry.register("vishu.memory_reindex", () => ok({ notes: store.reindex() }));

  // Session-end summary into the vault (Memory Tree rollup) — keeps persistent memory token-cheap.
  registry.register("vishu.memory_rollup", async (params) => {
    const p = (params ?? {}) as { since?: number; subject?: string };
    return ok(await rollupSession(store, { since: p.since, subject: p.subject }));
  });

  // Self-healing: evict stale superseded notes (bound growth), report conflicts/broken-links/orphans, and
  // (opt-in) auto-repair same-subject contradictions (resolveConflicts: keep newest, drop stale) and
  // dangling wikilinks (repairLinks: unlink dead [[targets]] in place, keeping the text).
  registry.register("vishu.memory_selfheal", (params) => {
    const p = (params ?? {}) as { olderThanDays?: number; resolveConflicts?: boolean; repairLinks?: boolean };
    return ok(selfHealMemory(store, { olderThanDays: p.olderThanDays, resolveConflicts: p.resolveConflicts, repairLinks: p.repairLinks }));
  });

  // Board write-back: flip a single todo checkbox line (drag To-do↔Done) and persist it in place.
  registry.register("vishu.memory_todo_set", (params) => {
    const p = (params ?? {}) as { note?: string; text?: string; done?: boolean };
    if (!p.note || !p.text) return err("invalid_params", "note and text are required");
    const updated = store.setTodo(p.note, p.text, p.done ?? true);
    return updated ? ok({ name: updated.name }) : err("not_found", "no matching todo line");
  });

  // Run the background maintenance workers (janitor/distiller/curator) on demand; each is isolated so
  // one failure can't abort the batch. Returns per-worker one-line summaries.
  registry.register("vishu.workers_run", async () => ok(await runWorkers(memoryWorkers(store))));
}
