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
    const p = (params ?? {}) as { query?: string; limit?: number };
    if (!p.query) return err("invalid_params", "query is required");
    return ok(await store.recall(p.query, p.limit));
  });

  registry.register("vishu.memory_reindex", () => ok({ notes: store.reindex() }));

  // Session-end summary into the vault (Memory Tree rollup) — keeps persistent memory token-cheap.
  registry.register("vishu.memory_rollup", async (params) => {
    const p = (params ?? {}) as { since?: number; subject?: string };
    return ok(await rollupSession(store, { since: p.since, subject: p.subject }));
  });

  // Self-healing: evict stale superseded notes (bound growth) + report same-subject conflicts.
  registry.register("vishu.memory_selfheal", (params) => {
    const p = (params ?? {}) as { olderThanDays?: number };
    return ok(selfHealMemory(store, { olderThanDays: p.olderThanDays }));
  });
}
