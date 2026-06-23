# Project Vishu — Full-Stack Reconstruction Blueprint

A **build-from-scratch blueprint** for the project (codename **Vishu**, rebuilt from the
existing Aetheria codebase): per-subsystem specs detailed enough to re-implement the system,
plus reference catalogs (RPC, DB, config, deps, edge cases).

> Sourced from the live repo's `AGENTS.md`, `gitbooks/developing/`, `Cargo.toml`,
> `app/package.json`, and the actual module tree (crate v0.57.18). Where this blueprint and
> the code disagree, the code wins — verify before trusting.

## Read in order

| Doc | Subsystem |
| --- | --- |
| [00-overview.md](00-overview.md) | What Vishu is, why it exists, scope, tech stack |
| [01-architecture.md](01-architecture.md) | Monorepo layout, process model, RPC + dual-socket flow, event bus |
| [02-setup-build-verify.md](02-setup-build-verify.md) | Toolchain, build/run commands, env, how the project is checked |
| [03-core-transport.md](03-core-transport.md) | `src/core/` — JSON-RPC, auth, boot sequence, controller registry |
| [04-domain-conventions.md](04-domain-conventions.md) | Canonical Rust domain module shape + the ~90 domains |
| [05-agent-harness.md](05-agent-harness.md) | Sessions, turns, tool loop, subagents |
| [06-agent-orchestration.md](06-agent-orchestration.md) | Orchestration, deliberator, registry, model routing |
| [07-memory-system.md](07-memory-system.md) | Memory tree/store, encryption, hybrid search, archivist |
| [08-inference-providers.md](08-inference-providers.md) | Provider factory, OpenAI-compatible layer, local models |
| [09-channels-integrations-mcp.md](09-channels-integrations-mcp.md) | Channels, Composio, MCP, webhooks |
| [10-config-security-credentials.md](10-config-security-credentials.md) | Config (full section ref + env), SecurityPolicy, sandbox, keyring, encryption |
| [11-data-stores-schemas.md](11-data-stores-schemas.md) | SQLite stores + full table inventory + migrations |
| [12-frontend-react.md](12-frontend-react.md) | `app/src/` — React 19, Redux, services, routing, i18n |
| [13-tauri-shell.md](13-tauri-shell.md) | `app/src-tauri/` — CEF host, IPC bridge, scanners, deep links |
| [14-runtimes-node-python.md](14-runtimes-node-python.md) | Managed Node runtime, Python runtime, skills, cron |
| [15-testing-ci.md](15-testing-ci.md) | Vitest, cargo tests, mock backend, WDIO E2E, coverage gate |
| [16-rebuild-roadmap.md](16-rebuild-roadmap.md) | Ordered, milestone-by-milestone build sequence |
| [17-rpc-catalog.md](17-rpc-catalog.md) | Every `vishu.*` JSON-RPC method, grouped by domain |
| [18-dependencies.md](18-dependencies.md) | Exact Rust + frontend dependency pins |
| [19-edge-cases.md](19-edge-cases.md) | Failure handling: classifiers, retries, circuit breakers, gotchas |
| [20-branding-and-what-changes.md](20-branding-and-what-changes.md) | Vishu rename map; what's free to change vs what must stay |

## One-paragraph summary

A desktop AI assistant for (crypto) communities. A **React 19 + TypeScript** UI runs inside a
**Tauri v2 (CEF)** shell. All real logic lives in a **Rust core** (`vishu-core`) that runs
**in-process** as a Tokio task and exposes **HTTP JSON-RPC** on `127.0.0.1` plus a CLI. The
core owns an AI **agent harness** (tools + subagents), an encrypted **memory** system with
hybrid vector/FTS search, the **MCP** tool protocol, **cron**, sandboxed tool execution,
multi-channel comms, and wallet/web3. SQLite (`rusqlite`) is the DB; the OS keychain holds
credentials; `rustls` does all TLS.

## How to use it for a rebuild

- **Backend = spec to re-implement faithfully** (docs 01, 03–11, 14, 17–19).
- **Frontend = reference to reinvent freely** — new logo/design/UI is expected (docs 12, 20).
- Build in the order of [16-rebuild-roadmap.md](16-rebuild-roadmap.md); each milestone ends
  in a verifiable green state.

## Caveat

A 610k-LOC system can't be regenerated verbatim from ~120K of prose. This is an
architecture + contract + build-order reference, not a literal code generator. Function
bodies, exact RPC params, and per-column DDL must be confirmed against the source files this
blueprint points to.
