# 01 — Architecture

## Monorepo layout

| Path | Role |
| --- | --- |
| `app/` | pnpm workspace `aetheria-app`: Vite + React UI (`app/src/`), Tauri host (`app/src-tauri/`), Vitest tests |
| `src/` (root) | Rust lib `aetheria_core` + `aetheria-core` CLI binary (`src/main.rs`): `src/core/` transport, `src/aetheria/*` domains |
| `Cargo.toml` (root) | Core crate. `cargo build --bin aetheria-core`. Also aux bins in `src/bin/`. |
| `gitbooks/developing/` | Contributor architecture docs |
| `docs/` | Deep internals |

Commands assume the **repo root**. Root `package.json` is `aetheria-repo` (private, pnpm-enforced).

## Process model

- The **core runs in-process** as a Tokio task inside the Tauri host (sidecar removed).
- Lifecycle: `CoreProcessHandle` in `app/src-tauri/src/core_process.rs`.
- The renderer calls the core over **HTTP JSON-RPC** at `http://127.0.0.1:<port>/rpc`.
- A **per-launch hex bearer token** is handed in-memory via
  `run_server_embedded_with_ready(rpc_token: Some(_))` — never crosses the process env.
  The renderer reads it via the `core_rpc_token` Tauri command.
- `AETHERIA_CORE_TOKEN` is honoured for standalone CLI / docker / cloud.
- `AETHERIA_CORE_REUSE_EXISTING=1` lets you attach to an externally-run core for debugging.

```
┌──────────────────────── Tauri Host (app/src-tauri) ───────────────────────┐
│  React UI (WebView / CEF)                                                  │
│        │  Tauri IPC: greet, core_rpc_relay, core_rpc_token, window cmds…   │
│        ▼                                                                   │
│  core_process (spawns) ──► aetheria-core (Tokio task)                      │
│                                  │  HTTP JSON-RPC 127.0.0.1:<port>/rpc     │
│                                  ▼                                         │
│         src/core (transport) ──► src/aetheria/<domain> (logic)            │
└───────────────────────────────────────────────────────────────────────────┘
```

## Two communication channels (frontend ↔ core)

1. **Tauri IPC** — a small set of shell commands (windows, AI config helpers, and crucially
   `core_rpc_relay` which proxies JSON-RPC, plus `core_rpc_token`).
2. **HTTP JSON-RPC** — all business logic. Method naming: `aetheria.<namespace>_<function>`.

Frontend rule: always call core RPC via `invoke('core_rpc_relay', …)` /
`coreRpcClient`, never direct fetch.

## JSON-RPC request flow

```
UI action → coreRpcClient → invoke('core_rpc_relay', {method, params})
  → Tauri host forwards to http://127.0.0.1:<port>/rpc  (Bearer <per-launch token>)
  → axum router (src/core/jsonrpc.rs)
  → controller registry dispatch (src/core/all.rs)  → domain schemas.rs handle_*()
  → domain ops.rs business logic  → RpcOutcome<T>  → JSON-RPC result
```

Public HTTP endpoints (standalone core): `GET /health`, `GET /schema`, `GET /events`.

## Dual-socket real-time architecture

Aetheria keeps a persistent realtime connection to its backend in **two** forms:

- **Desktop**: a **Rust-native** Socket.IO/Engine.IO v4 client (`src/aetheria/socket/`)
  over `tokio-tungstenite` + `rustls`. Survives app backgrounding, independent of the WebView.
- **Web** (non-shipping): a JS Socket.IO client.

Rust socket manager details:
- Handshake: WS connect → Engine.IO OPEN (`sid`, `pingInterval`, `pingTimeout`) →
  Socket.IO CONNECT with JWT → CONNECT ACK.
- Keep-alive: PONG to PING; timeout = `pingInterval + pingTimeout + 5s` (~50s).
- Reconnect: exponential backoff 1s→30s.
- `tool:sync`: on connect + every tool/skill lifecycle change, emit the full tool inventory
  so the backend AI always knows current capabilities.

**Dual-socket sync rule**: keep `socketService` (frontend) and the MCP transport aligned
with the core socket's behavior — they must not drift.

## Event bus (in-core pub/sub)

`src/core/event_bus/` — two mechanisms, both process singletons:

- **Broadcast** (`publish_global` / `subscribe_global`): fire-and-forget, many subscribers.
- **Native request/response** (`register_native_global` / `request_native_global`):
  one-to-one typed dispatch, zero serialization, internal only.

Core types: `DomainEvent` (events.rs), `EventBus` (bus.rs), `NativeRegistry`
(native_request.rs), `EventHandler`/`SubscriptionHandle` (subscriber.rs).
Event domains: `agent`, `memory`, `channel`, `cron`, `skill`, `tool`, `webhook`, `system`.

## End-to-end data flow (tool call)

```
User prompt → AI model receives prompt + tool catalog (tool:sync)
  → model emits mcp:toolCall {tool_name, arguments}
  → socket/registry routes to the unified Tool Registry
  → native Rust handler (or Node helper via runtime_node) executes
  → gated by SecurityPolicy + active sandbox backend
  → external call (reqwest/rustls, SQLite, keychain)
  → result → registry → socket → MCP → AI → UI
```

Everything is async on a fixed Tokio thread pool. Agent worker threads use an enlarged
stack (`AGENT_WORKER_STACK_BYTES`) because a turn + nested subagent is a very large async
state machine.
