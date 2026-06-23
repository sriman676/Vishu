# 00 — Overview: What, Why, How

## What it is

**Aetheria** — an AI assistant for communities (crypto-focused). A single React + Rust
(Tauri) codebase that ships as a **desktop app** for **Windows, macOS, and Linux**.
(Android/iOS/web exist as experimental targets only; not product-shipping.)

Core user-facing capabilities:

- **Conversational AI agent** with a tool-using harness and spawnable subagents.
- **Multi-channel comms**: Discord, Slack, Telegram, WhatsApp, IRC, email, Google Meet, etc.
- **Encrypted memory**: long-term memory with hybrid vector + full-text search, a
  hierarchical "memory tree", and a background archivist.
- **MCP tool protocol**: AI models discover and invoke any connected service's tools.
- **Skills**: metadata-only packages (`SKILL.md`) that inject tool descriptors into prompts.
- **Cron scheduler**: recurring/triggered automation (5-second tick).
- **Wallet / web3**: BTC, EVM (ethers), Solana, Tron signing.
- **Voice / meetings**: speech-to-text (whisper), meeting agents.
- **Composio + integrations**: external SaaS connectors (Gmail, Slack, Notion, …).

## Why it exists / why these choices

- **Tauri + Rust over Electron**: sub-500ms cold start, no GC pauses, compile-time memory
  safety, `rustls` TLS (no OpenSSL). Matters for users running it alongside heavy tools.
- **Rust core is authoritative**: all business logic, execution, persistence, and security
  live in Rust. The React/Tauri layer only **presents and orchestrates**. This keeps rules
  enforceable server-side and the UI thin/replaceable.
- **In-process core** (not a sidecar): the core runs as a Tokio task inside the Tauri host;
  the frontend reaches it over local HTTP JSON-RPC with a per-launch bearer token.
- **Native Rust tool execution** (+ a managed Node runtime for JS helpers): no per-tool VM.
  The legacy QuickJS per-skill execution engine was removed; skills are metadata now.

## How it's organized (one level deep)

```
aetheria/ (repo root)
├── app/                      # pnpm workspace "aetheria-app"
│   ├── src/                  # React 19 + TS frontend (Vite 7)
│   ├── src-tauri/            # Tauri v2 desktop host (CEF runtime)
│   └── src-tauri-mobile/     # experimental iOS/Android shell (non-shipping)
├── src/                      # Rust crate "aetheria" (lib aetheria_core)
│   ├── core/                 # transport: jsonrpc, auth, event_bus, cli, dispatch
│   ├── aetheria/<domain>/    # ~90 business domains (agent, memory, channels, …)
│   ├── bin/                  # aux binaries (slack-backfill, gmail-backfill-3d, …)
│   └── main.rs               # aetheria-core binary entry
├── Cargo.toml                # core crate (105 direct deps)
├── AGENTS.md                 # master conventions doc
├── gitbooks/developing/      # architecture + contributor docs
└── tests/                    # Rust integration / e2e tests
```

## Tech stack (verified versions)

| Layer | Tech | Version |
| --- | --- | --- |
| Frontend framework | React + TypeScript | React 19.1, TS 5.8 |
| State | Redux Toolkit + redux-persist | RTK 2.11 |
| Routing | react-router-dom (HashRouter) | 7.x |
| Build (UI) | Vite | 7.x |
| Styling | Tailwind CSS | — |
| Desktop shell | Tauri v2 (CEF runtime) | `@tauri-apps/api` 2.10 |
| Core language | Rust | edition 2021 |
| Async runtime | Tokio | full features |
| HTTP server | axum | 0.8 |
| HTTP client | reqwest | rustls |
| DB | SQLite via rusqlite | — |
| TLS | rustls | 0.23 |
| WebSocket | tokio-tungstenite + rustls | — |
| Crypto (memory) | aes-gcm + argon2 | AES-256-GCM, Argon2id |
| Credentials | keyring (OS keychain) | 3.x |
| Errors / observ. | thiserror, anyhow, tracing, sentry | — |
| JS runtime (helpers) | Node.js (managed) | v22.11.0 default |
| Wallets | bitcoin, ethers-*, ed25519-dalek, bs58, ripemd | — |
| Speech | whisper-rs | 0.16 |
| Node runtime | Node | >= 24 (build), pnpm |

Crate: `name = "aetheria"`, `version = 0.57.18`, `lib = aetheria_core`,
binaries: `aetheria-core` (main), `slack-backfill`, `gmail-backfill-3d`,
`memory-tree-init-smoke`, `inference-probe`, `test-mcp-stub`.

## Non-goals / removed

- No QuickJS/per-skill VM (removed PR #1061-era). Skills are metadata + tool descriptors.
- No core "sidecar" process — core is embedded in-process.
- No `localStorage` for secrets — Redux (memory) + OS keychain only.
- Mobile/web are not shipping targets.
