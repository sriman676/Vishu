<div align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="Vishu logo" />
  <h1>Vishu</h1>
  <p><strong>A local-first AI coding agent that never hits a rate limit, verifies the software it builds, and keeps your memory in plaintext you own.</strong></p>
  <p>
    <img alt="tests" src="https://img.shields.io/badge/tests-149%20passing-brightgreen">
    <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A524-blue">
    <img alt="license" src="https://img.shields.io/badge/license-MIT-green">
  </p>
</div>

---

## What is Vishu?

Vishu is a provider-agnostic, local-first agent that builds software. Reach for it when you want:

- **Memory you own.** A plaintext, Obsidian-editable markdown vault is the source of truth; the SQLite vector/FTS index is derived and rebuildable. Edit a note in Obsidian, delete the index — your knowledge never gets locked in a proprietary store.
- **No rate-limit walls.** One provider interface (OpenAI-compatible, Anthropic, Ollama) with a router that **fails over** on quota/limit/5xx **or load-balances across keys in parallel** — add backup keys and concurrent work spreads across them instead of hammering one.
- **Software it actually verifies.** `vishu build` runs a spec interview → your approval → a chunked multi-agent build on the Arbor hypothesis-tree engine → a **deterministic** security scan (OWASP Top-10, planted-vuln catch) → a maintainability gate. Security gates on a deterministic scanner, never on an LLM's own verdict.
- **More answer per token.** Test-time-compute amplifiers (self-consistency, Mixture-of-Agents, Reflexion, a difficulty router) plus RTK-style shell-output compression that squeezes noisy command output before it ever reaches the model.

CLI-first, cross-platform (built and tested on Windows), with a React/PWA frontend and a Rust/Tauri desktop harness — all speaking the same `vishu.*` JSON-RPC contract.

## Quickstart

**One command** to install + build (Windows PowerShell/cmd, Linux/bash, macOS — only Node ≥ 24 required; it provisions pnpm via corepack):

```bash
node setup.mjs            # or: npm run setup
```

Then:

```bash
cp .env.example .env      # then paste your key into VISHU_API_KEY (see below)

pnpm vishu chat "explain this repo"
pnpm vishu agent "add a /health endpoint and a test for it"
pnpm vishu build "a todo app with auth"      # guided secure build
pnpm vishu eval effort                        # measure quality vs baseline
pnpm vishu serve                              # JSON-RPC core (loopback)
```

> On Windows PowerShell, set env vars with `$env:VISHU_PROVIDER="openai"` instead of `export`.

### Just paste a key — the provider is auto-detected

Drop a key into `.env` and leave `VISHU_PROVIDER` unset. Vishu identifies the provider from the key's prefix:

| Key prefix | Provider |
|---|---|
| `sk-ant-…` | Anthropic |
| `nvapi-…` | NVIDIA NIM |
| `AIza…` | Google Gemini |
| `gsk_…` | Groq |
| `sk-or-…` | OpenRouter |
| `fw_…` | Fireworks |
| `xai-…` | xAI (Grok) |
| `pplx-…` | Perplexity |
| `sk-…` | OpenAI |

Or set `VISHU_PROVIDER` to a **preset** that auto-wires the endpoint + a default model (override with `VISHU_MODEL`): `gemini`, `openrouter`, `groq`, `deepseek`, `nvidia`, `mistral`, `together`, `fireworks`, `xai`, `perplexity`, `cohere`.

It also reads standard env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`, …). Any key var accepts a **comma-separated list** for failover.

### Multi-key & multi-provider routing (`VISHU_KEY_MODE`)

- `failover` (default) — try one, rotate to the next only on error.
- `balance` — round-robin every call across all keys, so concurrent amplifier/ensemble calls spread out instead of hitting one key's 429.
- `local` — route only to a local LLM when present. Fold one into the ring with `VISHU_LOCAL_BASE_URL=http://127.0.0.1:11434`.

**Pool different providers in parallel** (e.g. Anthropic + OpenAI + local Ollama at once): declare them in the config file (`~/.vishu/config.json` or `$VISHU_CONFIG`) — each carries its own model — then pick parallel vs sequential with `VISHU_KEY_MODE`:

```json
{ "providers": {
    "claude":  { "type": "anthropic", "apiKeys": ["sk-ant-…"], "model": "claude-opus-4-…" },
    "gpt":     { "type": "openai",    "apiKeys": ["sk-…"],     "model": "gpt-4o" },
    "local":   { "type": "ollama",    "baseUrl": "http://127.0.0.1:11434", "model": "llama3.2" }
} }
```

## What's inside

| Area | What it does |
|---|---|
| **Agent + tools** | `read/write/list`, `run_shell`, `web_fetch/search`, persistent terminal, code-graph retrieval — all behind a `SecurityPolicy` (tiers, command classification, path jail, prompt-injection guard, sandbox backends). |
| **Reliability** | Self-verification loop, git-worktree checkpoints/undo, risk-scoped approvals + autonomy levels, run log, cost meter + budget cap. |
| **Memory** | Obsidian-editable vault (entities/tasks/people as `[[wikilinked]]` notes) + derived SQLite FTS/vector recall, smart-walk over links, staleness/contradiction handling, self-healing eviction. |
| **Orchestration** | Arbor engine — Coordinator/Executor, hypothesis tree (branch/prune/harvest), subagents in isolated git worktrees that inherit-and-narrow the parent policy. |
| **Reasoning amplifiers** | `solve` (difficulty-routed), best-of-N self-consistency, Mixture-of-Agents, Reflexion — `vishu.reasoning_*`. |
| **Eval harness** | `vishu eval [baseline\|effort\|moa]` — scores runners on a task suite and tracks the trend over time. |
| **Secure app builder** | `vishu build` — spec interview → verify → chunked Arbor build → deterministic OWASP scan + bounded remediation → maintainability gate. |
| **TokenJuice** | HTML→Markdown, dedup, transcript compaction, active context curation, RTK-style per-command shell-output compression, and **reversible compression** (elided output is stashed under a ref the model can `retrieve_original`). |
| **Connectors / MCP** | stdio MCP client (tools/resources/prompts + reconnect + sampling), inbound triage, outbound `Connector` seam, realtime SSE. |
| **Optional modules** | Off by default behind `VISHU_MODULES`: `wallet` (EVM/Solana/BTC signing), `imagegen`, `voice` (whisper sidecar), `desktop`, `report` (research docs), `artifacts`, `pairing`, `selfupdate`. A throwing module can't crash the core. |
| **Frontend** | React/Vite + PWA over the `vishu.*` contract: chat, a **notifications** panel (budget/trigger/triage alerts, unread badge), **eval** + **token** dashboards, a **memory/vault browser**, and a **settings** panel showing the active provider/model/key-mode/pool with a model switcher. Rust/Tauri harness supervises the core and hands the UI a ready token. |

## Benchmarks

The built-in 8-task suite (4 easy + 4 hard), scored on **NVIDIA NIM `llama-3.1-8b-instruct`**:

| Runner | Pass rate | |
|---|---|---|
| `baseline` (single call) | 63% (5/8) | fails CRT bat-and-ball, two-leg distance, letter-count |
| `effort` (difficulty-routed) | 63% (5/8) | best-of-N ties baseline on this model |
| `moa` (multi-agent ensemble) | **75% (6/8)** | **recovers two hard tasks single-shot misses** |

Honest read: the hard tier makes the suite discriminate. **MoA wins** — its multi-perspective layers crack the CRT bat-and-ball and the letter-count that single-shot and best-of-N both miss. Two real lessons fall out: self-consistency (`effort`/best-of-N) fixes *variance*, not *bias* — it can't help when the model is reliably wrong, so it ties baseline here; and a small model used as the MoA aggregator still occasionally fumbles a trivial task (assign a stronger model to the judge role to close that). Run your own with `pnpm vishu eval <runner>` (use `VISHU_EVAL_CONCURRENCY=1` on a single rate-limited key); it records history and reports the trend.

## Configuration

All config is file + `VISHU_*` env (see `.env.example`). Common vars:

| Var | Purpose |
|---|---|
| `VISHU_PROVIDER` | `openai` / `anthropic` / `ollama` / `mock`, or a preset (`gemini`/`groq`/`nvidia`/…). Auto-detected from the key if unset. |
| `VISHU_API_KEY` / `VISHU_API_KEYS` | provider key; comma-separated list rotates/balances. |
| `VISHU_KEY_MODE` | `failover` (default) / `balance` / `local`. |
| `VISHU_MODEL` / `VISHU_BASE_URL` | override model + endpoint. |
| `VISHU_MODULES` | comma-list of optional modules to enable. |
| `VISHU_PORT` / `VISHU_CORE_HOST` | core bind (default `127.0.0.1:5712`). |

Secrets live in env or the OS keychain — **never** in the vault, never in the model context.

## Security posture

`pnpm audit`: 0 known vulnerabilities. No secrets in source or git history; `.env` is gitignored. SQL is fully parameterized; the frontend has no XSS sink. The transport is loopback-bound with a per-launch bearer token + CORS allowlist. The agent's shell/file execution is gated by `SecurityPolicy` (tiers + command classification + path jail) and a prompt-injection guard; `workspace_dir` is never agent-writable. The wallet keystore is scrypt→AES-256-GCM with keys loaded-then-discarded. *(AI-assisted audit — not a substitute for a professional pentest.)*

## Architecture

```
vishu/
├── packages/core/src/
│   ├── transport/  providers/  security/  tools/  reliability/
│   ├── tokenjuice/  skills/  memory/  orchestration/  reasoning/
│   ├── automation/  connectors/  appbuilder/  modules/  eval/  replay/
│   └── bin/vishu.ts        # CLI: serve | chat | agent | build | eval | report
└── packages/frontend/      # React/Vite + Tauri harness
```

The core is TypeScript/Node 24. Python (whisper sidecar) and Rust (Tauri harness) sit at subsystem boundaries over stdio/RPC — the right language per job, not TS-only.

## License

[MIT](LICENSE) © 2026 srimanrutvik224
