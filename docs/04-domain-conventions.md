# 04 — Rust Domain Conventions (`src/aetheria/<domain>/`)

Every business domain lives in its own subdirectory and follows one **canonical module
shape**. This is the single most important pattern to replicate — it makes the ~90 domains
uniform and the controller registry mechanical.

## The domain list (~90)

`about_app, accessibility, agent, agent_experience, agent_meetings, agent_memory,
agent_orchestration, agent_registry, agent_tool_policy, app_state, approval, artifacts,
audio_toolkit, autocomplete, billing, channels, codegraph, composio, config, connectivity,
context, cost, council_registry, credentials, cron, cwd_jail, dashboard, desktop_companion,
devices, doctor, embeddings, encryption, file_state, health, heartbeat, http_host, image,
inference, integrations, javascript, keyring, keyring_consent, learning, mcp_audit,
mcp_client, mcp_registry, mcp_server, meet, meet_agent, memory, memory_archivist,
memory_conversations, memory_entities, memory_graph, memory_queue, memory_sources,
memory_store, memory_sync, memory_tools, memory_tree, migration, migrations, model_council,
monitor, notifications, overlay, people, prompt_injection, provider_surfaces,
redirect_links, referral, routing, runtime_node, runtime_python, sandbox, scheduler_gate,
screen_intelligence, search, security, service, session_db, socket, startup, subconscious,
task_sources, team, test_support, text_input, threads, tls, todos, tokenjuice, tool_registry,
tool_timeout, tools, update, voice, wallet, web3, webhooks, webview_accounts, webview_apis,
whatsapp_data, workflows, workspace`

## Canonical module shape

| File | When | Role |
| --- | --- | --- |
| `mod.rs` | always | Export-focused only: `mod`/`pub mod` + `pub use` + controller schema pair. **No business logic.** |
| `types.rs` | domain has types | Serde domain types |
| `store.rs` | domain persists | Persistence layer (SQLite) |
| `ops.rs` | domain has logic | Business logic + handlers returning `RpcOutcome<T>` |
| `schemas.rs` | RPC-facing | Controller schemas + `handle_*` fns delegating to `ops.rs` |
| `tools.rs` | domain owns agent tools | Tool implementations |
| `bus.rs` | domain has event subscribers | `EventHandler` impls |
| `*_tests.rs` / inline `#[cfg(test)]` | new/changed behavior | tests |

## Hard rules

- **New functionality → dedicated subdirectory.** No new root-level `*.rs` files.
- **Tool ownership**: a domain's agent tools live in that domain's `tools.rs`, re-exported
  via `src/aetheria/tools/mod.rs`. Only cross-cutting tool families stay in `tools/impl/`.
- **Controller-only exposure**: register via the registry (`schemas.rs` → `all.rs`), never
  branch in `cli.rs`/`jsonrpc.rs`.
- **Memory source identity**: per-item IDs are dedupe keys only; set `metadata.path_scope`
  for the stable collection scope.
- **File size**: prefer ≤ ~500 lines.
- **Verbose debug logging is mandatory** on new/changed flows: entry/exit, branches,
  external calls, retries/timeouts, state transitions, errors. Grep-friendly prefixes
  (`[domain]`, `[rpc]`). Never log secrets/PII. Code lacking logging is incomplete.

## Controller migration checklist

1. `mod.rs`: add `mod schemas;`, re-export `all_controller_schemas` / `all_registered_controllers`.
2. `schemas.rs`: define schemas + `handle_*` delegating to `ops.rs`.
3. Wire into `src/core/all.rs`. Remove from `src/core/dispatch.rs`.

## Feature design workflow (the order to build any feature)

**Specify → prove in Rust → prove over RPC → surface in UI → test.**

1. Specify — ground in existing domains + controller patterns + RPC naming.
2. Implement in Rust — domain logic + unit tests.
3. JSON-RPC E2E — extend `tests/json_rpc_e2e.rs` / `scripts/test-rust-with-mock.sh`.
4. UI — React + `core_rpc_relay`/`coreRpcClient`. Keep rules in core.
5. App unit tests — Vitest.
6. App E2E — desktop specs.

Update `src/aetheria/about_app/` when adding/removing/renaming user-facing features.

## Coding philosophy

- Unix-style modules: small, single-responsibility, composed through clear boundaries.
- Tests before the next layer; untested code is incomplete.
- Docs with code: update `AGENTS.md`/architecture docs when rules or behavior change.
