# 16 — Rebuild Roadmap (ordered build sequence)

A milestone-by-milestone order to rebuild Aetheria from scratch. Each milestone ends with a
**verifiable** state — don't start the next until the current one checks green. Build the
**core first** (it's authoritative), then the shell, then the UI.

> Reality check: this is the *order and contracts*, not literal source. Expect each
> milestone to be substantial. Reuse the existing crates/deps in `Cargo.toml` and
> `app/package.json` rather than re-deriving them.

## Milestone 0 — Workspace & toolchain
- Cargo workspace: root crate `aetheria` (lib `aetheria_core`, bin `aetheria-core`),
  `app/src-tauri` crate, vendored `tauri-cef`.
- pnpm workspace `aetheria-app` under `app/`.
- Install vendored tauri-cli; set up `.env.example` files + `scripts/load-dotenv.sh`.
- ✅ Check: `cargo check` and `pnpm install` succeed.

## Milestone 1 — Core transport skeleton (doc 03)
- Tokio runtime (enlarged worker stack), axum `/rpc` + `/health` `/schema` `/events`.
- Bearer auth (per-launch + env + `core.token`). `RpcOutcome<T>`. Controller registry (`all.rs`).
- Event bus (broadcast + native req/resp). tracing/log + Sentry. Graceful shutdown.
- ✅ Check: `aetheria-core serve` boots, `GET /health` returns OK, one trivial RPC round-trips.

## Milestone 2 — Config, security, credentials (doc 10)
- `Config` TOML + env overrides; `load_or_init`.
- `action_dir`/`workspace_dir` split with fail-closed `is_workspace_internal_path`.
- `SecurityPolicy` tiers + command classification + `gate_decision`.
- Keyring (`init_master_key`) + encryption (AES-256-GCM/Argon2id). Approval gate. Prompt-injection guard.
- ✅ Check: config loads; forbidden paths blocked; secrets round-trip via keychain.

## Milestone 3 — Data stores (docs 07, 11)
- Domain `types.rs` → `store.rs` (`get_or_init_connection` + DDL + circuit breaker).
- `memory::global::init` + `whatsapp_data::global::init`. Migrations runner.
- ✅ Check: fresh `workspace_dir` bootstraps all SQLite schemas; busy/locked retry works.

## Milestone 4 — Domain conventions + a vertical slice (doc 04)
- Establish the canonical module shape; build ONE full domain end-to-end
  (e.g. `todos` or `health`) with `types/store/ops/schemas` + controller registration + tests.
- ✅ Check: its RPCs appear in `/schema` and pass `tests/json_rpc_e2e.rs`.

## Milestone 5 — Memory system (doc 07)
- Chunking, embeddings (`embeddings/factory.rs`), vectors, FTS5, hybrid search, memory-tree
  (buckets/sealing/runtime engine), archivist, entities/graph.
- ✅ Check: write → recall via hybrid search; tree seals; encrypted at rest.

## Milestone 6 — Inference & providers (doc 08)
- Provider trait + factory; OpenAI-compatible client; reliability (retry/fallback/transient
  classification); local (Ollama, whisper). Routing + quality checks.
- ✅ Check: a chat round-trips against the mock backend; transient 5xx retries.

## Milestone 7 — Agent harness (doc 05)
- Agent definitions (built-in + loader); session/turn lifecycle; tool loop; tool filter;
  transcript + compaction; subagent runner; payload summarizer; token budget.
- ✅ Check: a turn calls a tool, gets a result, completes; a subagent spawns and returns.

## Milestone 8 — Orchestration + tools + MCP (docs 06, 09)
- Tool registry; orchestration/deliberator; `spawn_subagent`/`spawn_worker_thread`;
  agent archetypes; MCP client/registry/server; `tool:sync`.
- ✅ Check: tool catalog exposed over MCP; orchestrated multi-step request works.

## Milestone 9 — Channels, integrations, webhooks, cron, runtimes (docs 09, 14)
- Channel providers; Composio + periodic sync; webhooks; cron tick loop; Node/Python runtimes.
- ✅ Check: a message inbound→outbound on one channel; a cron trigger fires; a Node helper runs.

## Milestone 10 — Realtime socket (doc 01)
- Rust-native Socket.IO/Engine.IO v4 client over tokio-tungstenite+rustls; handshake,
  keep-alive, reconnect, `tool:sync`.
- ✅ Check: connects to backend, survives reconnect, syncs tools.

## Milestone 11 — Tauri shell (doc 13)
- `core_process` (spawn + `rpc_token`), `core_rpc_relay`, `core_rpc_token`, CEF runtime,
  window/deep-link plumbing, scanners. Vendored tauri-cli bundling.
- ✅ Check: `cargo tauri dev` launches; renderer reaches core via relay.

## Milestone 12 — Frontend (doc 12)
- Provider chain, Redux slices, services (`coreRpcClient` via `core_rpc_relay`), routing,
  i18n, config, Tailwind tokens.
- ✅ Check: `pnpm dev:app` boots; auth snapshot loads; chat sends a turn end-to-end.

## Milestone 13 — Testing, CI, packaging (doc 15)
- Vitest + cargo tests + WDIO E2E + mock backend; coverage gate; installers (.msi/.dmg/.AppImage/.deb).
- ✅ Check: full suite green; ≥80% changed-line coverage; installers build.

## Build-order rule of thumb
Core logic → prove in Rust → prove over RPC → surface in UI → test. Never build a UI for a
capability the core can't yet do over RPC.
