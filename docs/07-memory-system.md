# 07 — Memory System

Aetheria's memory is a multi-domain subsystem: encrypted at rest, hybrid search, and a
hierarchical "tree" with a background archivist. This is the largest cluster of domains.

## Domains

| Domain | Role |
| --- | --- |
| `memory/` | Top-level memory API: read RPC, query/walk, schema, ops, global init |
| `memory_tree/` | Hierarchical memory tree: buckets, sealing, scoring/embedding, runtime engine, RPC |
| `memory_store/` | Persistence: chunks, vectors, segments, trees, fts5, events, profile |
| `memory_entities/` | Entity extraction + store |
| `memory_graph/` | Knowledge-graph relations (entity relationships) |
| `memory_conversations/` | Conversation tokenization + cross-thread search index |
| `memory_sources/` + `memory_sync/` | Ingest from sources; canonicalization + rebuild |
| `memory_queue/` | Async ingest queue + handlers |
| `memory_archivist/` | Background archival / smart archival |
| `memory_tools/` | Agent-facing memory tools |
| `agent_memory/` | Per-agent memory glue |
| `embeddings/` | Embedding backends (`embeddings/factory.rs`) |
| `encryption/` | AES-256-GCM + Argon2id helpers |
| `subconscious/` | Background reflection engine (`subconscious/engine.rs`) |

## How it works

- **Encryption at rest**: AES-256-GCM with Argon2id key derivation from user credentials.
  Memory files are unreadable without auth. Master key loaded via `keyring::init_master_key`.
- **Chunking**: ~512 tokens/chunk, ~64-token overlap (`memory_store/chunks/`).
- **Hybrid search**: ~70% vector similarity + ~30% SQLite **FTS5** full-text
  (`memory_store/vectors/` + `memory_store/fts5`). Query/walk in `memory/query/`
  (`smart_walk.rs`, `walk.rs`).
- **Embeddings**: default OpenAI `text-embedding-3-small`; pluggable via `embeddings/factory.rs`
  and `memory_tree/score/embed/factory.rs`.
- **Memory tree**: facts roll up into buckets; buckets seal (`memory_tree/tree/bucket_seal.rs`);
  the runtime engine (`memory_tree/tree_runtime/engine.rs`) maintains levels and summaries.
- **Knowledge graph**: entity relations (historically Neo4j via REST; verify current backend
  in `memory_graph/`).
- **Sessions**: JSONL transcripts with compaction + tool compression (see harness).

## Global init (called during core boot)

```rust
memory::global::init(workspace_dir)         // opens memory SQLite stores
whatsapp_data::global::init(workspace_dir)  // separate WhatsApp data store
```
On `Config::load_or_init` failure these are **skipped** (no silent fallback to a default
workspace — that would cause chunk loss / cross-workspace bleed-over). Callers then get an
explicit "memory client not ready" error.

## Stores (SQLite)

`memory_store/` holds the schemas: `chunks`, `vectors`, `segments`, `trees`, `fts5`,
`events`, `profile`. Per-path circuit breaker guards init failures
(`memory_store::chunks::store::get_or_init_connection`).

## Contracts to preserve

- `metadata.path_scope` is the stable collection scope; per-item IDs are dedupe keys only.
- Encryption is non-negotiable — never write memory plaintext to disk.
- Hybrid search weighting and chunk sizes are tunable knobs, not magic constants — keep them
  configurable.
