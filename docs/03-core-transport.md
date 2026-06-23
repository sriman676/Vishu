# 03 — Rust Core: Transport Layer (`src/core/`)

`src/core/` is **transport only — no business logic**. It wires the JSON-RPC server, auth,
the event bus, logging/observability, and the CLI, then dispatches to domain controllers.

## Modules

| Module | Role |
| --- | --- |
| `main.rs` (root `src/`) | `aetheria-core` binary entry → builds Tokio runtime with enlarged worker stack → `jsonrpc::run_server` |
| `core/cli.rs` | CLI arg dispatch (`serve`, `mcp`, memory/agent subcommands). Routes `serve` → `run_server` |
| `core/jsonrpc.rs` | axum HTTP server, JSON-RPC envelope, bind/port pick, `run_server`/`run_server_embedded[_with_ready]`/`run_server_inner` |
| `core/auth.rs` | Per-process RPC bearer token (`init_rpc_token[_with_value]`, `get_rpc_token`, `CORE_TOKEN_ENV_VAR`) |
| `core/all.rs` | Controller registry: `all_registered_controllers()`, `all_controller_schemas()` |
| `core/dispatch.rs` | Legacy direct dispatch (being migrated to the registry — remove entries as domains migrate) |
| `core/event_bus/` | Typed pub/sub + native request/response (see 01-architecture) |
| `core/runtime.rs` | Runtime bootstrap helpers, `AGENT_WORKER_STACK_BYTES` |
| `core/logging.rs`, `core/observability.rs` | tracing/log setup; Sentry `before_send` noise filtering + error classifiers |
| `core/socketio.rs` | Socket.IO server-side glue |
| `core/types.rs`, `core/jsonrpc` helpers | Shared transport types, `RpcOutcome<T>` |
| `core/shutdown.rs` | Cancellation token plumbing for graceful shutdown |
| `core/memory_cli.rs`, `core/agent_cli.rs` | CLI subcommands for memory/agent ops |

## JSON-RPC server boot (`run_server_inner`)

Authoritative "launch → serving" sequence (instrument here for startup profiling):

1. `all::all_registered_controllers()` — register all controllers.
2. `keyring::init_master_key()` — load master encryption key from OS keychain.
3. RPC token init — `init_rpc_token_with_value` (embedded) or `init_rpc_token` (file/env).
4. `Config::load_or_init().await` — load TOML config (fail-loud; no silent default fallback).
5. `memory::global::init(workspace_dir)` — open memory SQLite stores.
6. `whatsapp_data::global::init(workspace_dir)` — open WhatsApp data store.
7. `workflows::registry::prune_legacy_default_workflows(...)` — fs cleanup.
8. Session/Sentry user bind (`build_session_state` → `sentry_scope::bind`).
9. Resolve host/port (CLI > env > default); public-bind safety check (refuse non-loopback
   without explicit token).
10. `connectivity::rpc::pick_listen_port_for_host` — bind the listener.
11. Build axum router → `axum::serve(listener, app)` → **READY** (send `EmbeddedReadySignal`).

> Likely startup hotspots: keychain read (#2), config load (#4), the two SQLite inits
> (#5/#6). Profile these first.

## Controller registry pattern (how RPC methods are exposed)

Domains expose RPC via a **registry**, not by editing `cli.rs`/`jsonrpc.rs`:

1. Domain `mod.rs` adds `mod schemas;` and re-exports its `all_controller_schemas` /
   `all_registered_controllers`.
2. Domain `schemas.rs` defines the controller schema + `handle_*` fns that delegate to `ops.rs`.
3. Wire the domain into `src/core/all.rs`; remove any legacy branch from `dispatch.rs`.

Method naming convention: `aetheria.<namespace>_<function>`.

## Event bus usage

- Add an event: extend `DomainEvent`, extend the `domain()` match, create `<domain>/bus.rs`
  with an `EventHandler`, register at startup, publish via `publish_global`.
- Add a native handler: define req/resp types (`Send + 'static`, not `Serialize`), register
  at startup keyed `"<domain>.<verb>"`, dispatch via `request_native_global`.

## Rebuild checklist for this layer

- [ ] Tokio multi-thread runtime with enlarged worker stack.
- [ ] axum JSON-RPC endpoint `/rpc` + `/health` `/schema` `/events`.
- [ ] Bearer-token auth (per-launch in-memory + `AETHERIA_CORE_TOKEN` fallback + `core.token` file).
- [ ] Controller registry (`all.rs`) + `RpcOutcome<T>` envelope.
- [ ] Event bus (broadcast + native req/resp) as singletons.
- [ ] tracing/log + Sentry with transient-error noise filtering.
- [ ] Graceful shutdown via `CancellationToken`.
