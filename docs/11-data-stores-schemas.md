# 11 — Data Stores & Schema

Aetheria/Vishu persists everything locally in **SQLite** (via `rusqlite`) under the user's
`workspace_dir`, plus secrets in the OS keychain. No external DB is required to run.
This doc is both the conceptual store guide **and** the full table inventory (~67 tables).
Exact columns/indexes live in each domain's `store.rs` `CREATE TABLE` DDL.

## Where data lives

- `workspace_dir` = `~/.vishu/users/<id>/workspace` (internal state; agent-unwritable).
- Per-domain SQLite databases opened lazily/at boot via each domain's `store.rs`.
- Secrets → OS keychain (never SQLite plaintext).
- Encrypted memory blobs → AES-256-GCM at rest.

## Major stores (where to look)

| Store | Domain | Contents |
| --- | --- | --- |
| Memory chunks | `memory_store/chunks/` | Chunked text + token counts; per-path circuit breaker on init |
| Vectors | `memory_store/vectors/` | Embedding vectors for similarity search |
| FTS5 index | `memory_store/fts5` | Full-text search index (hybrid search keyword half) |
| Segments / trees | `memory_store/{segments,trees}/` | Memory-tree buckets + tree metadata |
| Events | `memory_store/events` | Memory event log |
| Profile | `memory_store/profile` | User profile facets (`prf-*` ids, `FacetType`) |
| Conversations | `memory_conversations/` | Tokenized cross-thread search index |
| Threads | `threads/` | Chat threads |
| Sessions | `session_db/` | Agent session persistence |
| Todos / tasks | `todos/`, `task_sources/` | Task data |
| Devices | `devices/` | Paired devices (iOS pairing) |
| WhatsApp data | `whatsapp_data/` | Separate ingest store (`whatsapp_data::global::init`) |
| Credentials/profiles | `credentials/` | User/session profiles (+ keychain) |
| Cron | `cron/` | Schedules |

## Table inventory (by store)

> Extracted from `CREATE TABLE` statements in `src/`. Open the owning `store.rs` for precise
> column types/indexes. A few grep fragments (`IF`, `above`, `t`) were filtered out.

### Memory tree (`memory_store/`, `memory_tree/`)
`mem_tree_trees` (tree metadata: kind/scope/status/levels), `mem_tree_chunks` (chunked
source ~512 tok/~64 overlap), `mem_tree_chunk_embeddings`, `mem_tree_chunk_reembed_skipped`,
`mem_tree_summaries` (bucket rollups), `mem_tree_summary_embeddings`,
`mem_tree_summary_reembed_skipped`, `mem_tree_buffers` (pending pre-seal), `mem_tree_entity_index`,
`mem_tree_entity_hotness`, `mem_tree_ingested_sources` (dedupe/provenance), `mem_tree_jobs`,
`mem_tree_score`.

### Memory / vectors / segments
`memory_docs` (`memory_doc_put`), `vectors`, `vector_chunks`, `conversation_segments`,
`segment_embeddings`, `episodic_log`, `event_log`, `event_embeddings`, `run_events`,
`graph_global`, `graph_namespace` (knowledge graph), `kv_global`, `kv_namespace` (key-value),
`user_profile` (facets), `store_meta`, `manifest`.

### Sessions & agent runs
`sessions`, `session_messages`, `session_tool_calls`, `agent_runs`, `run_telemetry`,
`workflow_runs`.

### Subconscious (background reflection)
`subconscious_state`, `subconscious_log`, `subconscious_reflections`, `subconscious_tasks`,
`subconscious_escalations`, `subconscious_hotness_snapshots`.

### Channels / integrations
`wa_chats`, `wa_messages` (WhatsApp, separate store), `integration_notifications`,
`notification_settings`, `mcp_servers`, `mcp_client_env`, `mcp_registry_cache`, `mcp_writes`,
`cookies` (webview accounts), `redirect_links`.

### Scheduling / tasks / devices / misc
`cron_jobs`, `cron_runs`, `ingested_tasks`, `task_sources`, `paired_devices`,
`pending_approvals` (approval gate, 10-min TTL), `heartbeat_notification_state`,
`vault_watcher_state`, `_people_migrations`, `legacy_marker`.

> Verify in source before relying on: `blob`, `handle`, `message` (likely sub-tables of
> people/whatsapp stores).

## Migrations

- `src/aetheria/migration/` and `src/aetheria/migrations/` — schema migration runners.
- Stores generally self-init schema (idempotent DDL on first connect).
- `TreeKind`/`TreeStatus` are serde enums in `memory_tree::tree` / `memory_store/trees/types.rs`.

## Patterns to preserve

- **Per-path circuit breaker** on store init (`get_or_init_connection`): too many consecutive
  failures → open breaker, surface a classified error, don't retry forever or crash.
- **SQLite busy/locked**: retry transient `database is locked` (code 5); treat persistent
  `CANTOPEN`/IOERR (codes 14/4618) as host-FS failure (classified).
- Vector tables pair a base table with an `*_embeddings` table — keep the pairing.
- **Fail-loud config**: never silently fall back to a default workspace (data-loss risk).
- All DB files under `workspace_dir`, never `action_dir`.

## For a from-scratch rebuild

1. Define each domain's `types.rs` (serde) first.
2. Then `store.rs` with `get_or_init_connection` + idempotent DDL + the circuit breaker.
3. Add a migration runner only when a schema must evolve.
4. Keep all DB files under `workspace_dir`.
