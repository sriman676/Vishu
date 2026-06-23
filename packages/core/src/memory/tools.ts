import type { ToolRegistry } from "../tools/registry.js";
import type { MemoryStore } from "./store.js";

/** Agent-facing memory: write a fact, recall by query. Recall returns gathered notes (FTS + smart-walk
 * over [[links]]), never a vault dump — token-frugal by construction. */
export function registerMemoryTools(registry: ToolRegistry, store: MemoryStore): void {
  registry.register({
    name: "memory_write",
    description: "Save a durable memory (a fact about the user/project). Pass `subject` to supersede a prior fact about the same thing.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The memory text; may contain [[wikilinks]] to other notes." },
        subject: { type: "string", description: "Optional stable key; a new note with the same subject supersedes the old one." },
        type: { type: "string", description: "fact | entity | project | task | person (default: fact)." },
      },
      required: ["content"],
    },
    run: async (args) => {
      const note = store.put({
        content: String(args.content ?? ""),
        subject: args.subject ? String(args.subject) : undefined,
        type: args.type ? String(args.type) : undefined,
      });
      return `saved memory: ${note.name}`;
    },
  });

  registry.register({
    name: "memory_recall",
    description: "Recall saved memories relevant to a query (hybrid search + link traversal).",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (args) => {
      const { text } = store.recall(String(args.query ?? ""));
      return text || "no relevant memories";
    },
  });
}
