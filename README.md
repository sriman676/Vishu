<div align="center">
  <img src="assets/logo.svg" width="88" height="88" alt="Vishu logo" />
  <h1>Vishu</h1>
  <p><strong>The local-first coding agent that never hits a rate limit and verifies the software it builds.</strong></p>
</div>

---

## What is Vishu?

Vishu is a provider-agnostic, local-first AI agent that builds software. Reach for it when you want:

- **Memory you own** — a plaintext, Obsidian-editable markdown vault is the source of truth; the SQLite vector/FTS index is derived and rebuildable. Your knowledge never gets locked inside a proprietary store.
- **No rate-limit walls** — one provider interface (OpenAI-compatible, Anthropic, Ollama) with a router that rotates provider **and** key on quota/limit/5xx errors. Add backup keys and it fails over automatically.
- **Software it actually verifies** — the flagship `vishu build` runs a spec interview → your approval → a chunked multi-agent build on the Arbor hypothesis-tree engine → a deterministic security scan (OWASP Top-10, planted-vuln catch) → a maintainability gate. Security is gated on a deterministic scanner, never on an LLM's own verdict.

It runs on Windows and is cross-platform. CLI-first, with a React/PWA frontend and a Tauri desktop shell — all speaking the same `vishu.*` JSON-RPC contract.

## Status

**Phases 0–14 complete and green** (92 core tests passing; frontend builds clean; Rust harness compiles). The whole requested backlog is built too. The native **harness** (Rust/Tauri) now supervises the core — spawns `vishu serve`, restarts it on crash, and hands the UI a ready bearer token so you never paste one (`pnpm tauri:dev`). The one named upgrade left is the *packaged* binary's cross-origin path (webview→core), which needs core CORS or a harness-side proxy. See [`PLAN.md`](PLAN.md) for the full phase-by-phase record.

## Quickstart

```bash
pnpm install              # Node 24+, pnpm workspace
pnpm -r build             # build all packages

# run the core (loopback JSON-RPC, prints its bearer token path)
vishu serve

# one-shot chat / autonomous tool loop / guided secure build
vishu chat "explain this repo"
vishu agent "add a /health endpoint and test it"
vishu build "a todo app with auth"

# frontend (web): start the core, then
pnpm dev:app              # Vite dev server on :5800, paste the printed core.token
# desktop shell (native): from packages/frontend
pnpm tauri:dev
```

## Configuration (env)

All config is file + `VISHU_*` env. The common ones:

| Var | Purpose |
|---|---|
| `VISHU_PORT` / `VISHU_CORE_HOST` | core bind (default `127.0.0.1:5712`) |
| `VISHU_MODULES` | comma-list of optional modules to enable (off by default) |
| `VISHU_WEBHOOKS` | `{"channel":"https://hook"}` outbound webhook connectors |
| `VISHU_MCP_SERVERS` | `[{"id","cmd","args"}]` external MCP tool servers |
| `VISHU_WALLET_KEYSTORE` + `VISHU_WALLET_PASSPHRASE` | encrypted EVM signing key (or `VISHU_WALLET_KEY` for dev) |
| `VISHU_IMAGE_API_KEY` | image-gen module (OpenAI-compatible) |

Secrets live in the OS keychain or env — **never** in the vault and never in the model context.

## Optional modules (flag: `VISHU_MODULES`)

Off by default; a failing module can never crash the core. `wallet` (EVM/Solana/BTC signing), `imagegen`, `voice` (whisper STT via a Python sidecar), `desktop` (cross-platform screen capture), plus `artifacts`, `pairing`, `selfupdate`.

The Python sidecars (`voice` → whisper, optional Semgrep SAST) are the only non-Node deps and are optional — install them only if you use those features: `pip install -r requirements.txt`. Absent, each returns a clear error instead of crashing.

## Architecture

```
vishu/  (pnpm monorepo)
├── assets/logo.svg
├── packages/core/        # TypeScript spine: transport, providers, agent, tools,
│   ├── src/              #   reliability, tokenjuice, skills, memory, orchestration,
│   └── sidecar/          #   automation, connectors, appbuilder, modules, personalization
└── packages/frontend/    # React + Vite app (PWA) + src-tauri/ desktop shell
```

The core is TypeScript/Node 24+ (CLI, RPC, agent loop). Best-language-per-job at the edges: Python sidecars (whisper STT, Semgrep SAST) over stdio JSON; Rust (Tauri) for the desktop host. Everything talks to the core over the `vishu.*` JSON-RPC contract.

## Frontier problems (addressed best-effort, not claimed solved)

Async multi-agent coordination, long-horizon autonomous reliability, continual self-improvement without drift, memory staleness/contradiction, unbounded memory growth, deterministic replay. Vishu's stance is **best-effort with a human gate** — deterministic checks gate security, the digital-twin suggests but never auto-applies, the vault is an immutable audit trail. None are claimed solved.

---

## Brand & logo brief

For regenerating, rasterizing, or iterating the mark (hand this section to a design tool or another Claude):

- **Concept:** three branches rising from a single root node — a "V/Y" monogram that encodes Vishu's identity: the **Arbor hypothesis-tree** (orchestration), **multi-agent branches**, and the **knowledge-graph vault** (memory).
- **Canvas:** 64×64 viewBox, rounded square (corner radius 15), background `#0e1116`.
- **Strokes:** three lines from the root `(32,47)` to leaf nodes at `(18,18)`, `(46,18)`, `(32,15)`. Width ~4.5, round caps.
- **Color:** vertical mint→teal gradient, `#7ef0bd` (top) → `#3fbf8c` (bottom).
- **Nodes:** filled leaf circles (r≈4–4.5) at the three tips; a hollow root node at `(32,47)` (r≈5.5, dark fill, green ring).
- **Feel:** simple, elegant, geometric. No gloss, no 3D, no text inside the mark.

Original mark designed for this project (global uniqueness is not legally guaranteed without a trademark search).

## License

TBD.
