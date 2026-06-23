# 14 — Embedded Runtimes (Node & Python)

Aetheria embeds language runtimes for tool execution beyond native Rust handlers. Skills no
longer run in an in-process QuickJS VM — that engine was removed.

## Node runtime (`src/aetheria/runtime_node/` + `javascript/`)

- **Purpose**: run JS/Node-backed tool helpers and skill-adjacent code that isn't a native
  Rust handler. The public language slot is `javascript`; the backend is `runtime_node`.
- **Resolution**: prefer a compatible system `node`; otherwise install a managed Node
  distribution into the Aetheria cache.
  - Default managed version: **Node v22.11.0**.
  - Integrity: SHA-256 verified against `SHASUMS256.txt`.
- **Bridge APIs** exposed to runtime helpers:

  | Bridge | Capability |
  | --- | --- |
  | `net` | HTTP fetch via reqwest (30s default timeout) |
  | `db` | SQLite per skill via rusqlite |
  | `store` | Key-value persistence |
  | `cron` | Schedule registration (6-field cron) |
  | `log` | Structured logging via Rust `log` |
  | `tauri` | Platform detection, notifications, whitelisted env vars |

- **Tool bridge**: `SKILL.md` packages provide metadata + optional bundled JS helpers; the
  Rust core owns the authoritative tool registry; the JS bridge lists tools and dispatches
  named tool calls into the core or Node helpers.

## Python runtime (`src/aetheria/runtime_python/`)

- Bootstraps a Python environment for Python-based tools/skills (`bootstrap.rs`).
- Same gating: execution flows through `SecurityPolicy` + the active sandbox backend.

## Skills (`src/aetheria/skills/`) — metadata only

- Helpers: `ops_create`, `ops_discover`, `ops_install`, `ops_parse`, `inject`, `schemas`,
  `types`.
- Skills are synced from a GitHub repo, discovered at runtime via `SKILL.md`, and contribute
  tool descriptors injected into agent prompts. No per-skill VM.

`SKILL.md` fields: `name`, `description`, `metadata.id` (stable slug), `allowed-tools`,
plus bundled resources (scripts/references/assets).

## Cron (`src/aetheria/cron/`)

A 5-second tick loop checks all registered schedules against UTC (using the `cron` crate),
firing `CronTrigger` events to handlers when due.

## Contracts to preserve

- Never resurrect an in-process JS VM per skill — use the shared Node bridge.
- Verify managed-runtime downloads by hash before executing.
- All runtime tool calls are gated by `SecurityPolicy`.
