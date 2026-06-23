import { err, ok, type Registry } from "../transport/rpc.js";
import type { MemoryStore } from "./store.js";

/** Expose memory over `vishu.memory_*` (see docs/17 RPC catalog). */
export function registerMemory(registry: Registry, store: MemoryStore): void {
  registry.register("vishu.memory_doc_put", (params) => {
    const p = (params ?? {}) as { content?: string; subject?: string; type?: string };
    if (!p.content) return err("invalid_params", "content is required");
    return ok(store.put({ content: p.content, subject: p.subject, type: p.type }));
  });

  registry.register("vishu.memory_recall_memories", (params) => {
    const p = (params ?? {}) as { query?: string; limit?: number };
    if (!p.query) return err("invalid_params", "query is required");
    return ok(store.recall(p.query, p.limit));
  });

  registry.register("vishu.memory_reindex", () => ok({ notes: store.reindex() }));
}
