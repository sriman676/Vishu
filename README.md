<div align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="Vishu logo" />
  <h1>Vishu</h1>
  <p><strong>The coding agent that never hits a rate limit.</strong></p>
  <p>One interface over every provider you have keys for. When one 429s, Vishu fails over; when you have work to spread, it load-balances across keys in parallel. Your laptop's local model is just another key in the ring.</p>
  <p>
    <img alt="tests" src="https://img.shields.io/badge/tests-152%20passing-brightgreen">
    <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A524-blue">
    <img alt="license" src="https://img.shields.io/badge/license-MIT-green">
  </p>
</div>

---

## Why Vishu

Every other agent is married to one vendor. Hit the limit and you wait, or you pay for a higher tier, or you stop. Vishu treats your providers as a **pool**: paste the keys you already have — Anthropic, OpenAI, a Gemini free tier, Groq, a local Ollama — and it routes across them.

```bash
VISHU_API_KEYS=sk-ant-…,sk-…,gsk_…   VISHU_KEY_MODE=balance
```

- **`failover`** — run on one key, rotate to the next only on quota/limit/5xx. Backup keys = no walls.
- **`balance`** — round-robin every call, so a multi-agent burst spreads across keys instead of hammering one 429.
- **`local`** — prefer a local LLM when present; fold it in with `VISHU_LOCAL_BASE_URL=http://127.0.0.1:11434`.

That's the wedge. The rest of Vishu exists to make a never-throttled agent actually trustworthy:

**Memory you own.** A plaintext, Obsidian-editable markdown vault is the source of truth; the SQLite vector/FTS index is derived and rebuildable. Edit a note by hand, delete the index — nothing is locked in a proprietary store.

**Software it verifies, not vibes.** `vishu build` runs a spec interview → your approval → a chunked multi-agent build → a **deterministic** OWASP Top-10 scan → a maintainability gate. Security gates on a real scanner, **never** on an LLM grading its own work.

## Quickstart

One command — Windows / Linux / macOS, only Node ≥ 24 required (it provisions pnpm via corepack):

```bash
node setup.mjs            # or: npm run setup
cp .env.example .env      # paste a key into VISHU_API_KEY
```

```bash
pnpm vishu chat  "explain this repo"
pnpm vishu agent "add a /health endpoint and a test for it"
pnpm vishu build "a todo app with auth"      # guided secure build
```

> Windows PowerShell sets env vars with `$env:VISHU_API_KEY="…"`, not `export`.

### Just paste a key — the provider is auto-detected

Leave `VISHU_PROVIDER` unset and Vishu reads the provider off the key prefix:

| Prefix | Provider | | Prefix | Provider |
|---|---|---|---|---|
| `sk-ant-…` | Anthropic | | `sk-or-…` | OpenRouter |
| `nvapi-…` | NVIDIA NIM | | `fw_…` | Fireworks |
| `AIza…` | Google Gemini | | `xai-…` | xAI (Grok) |
| `gsk_…` | Groq | | `sk-…` | OpenAI |

Standard vars work too (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, …), and any key var accepts a comma-separated list for failover. Different providers in parallel? Declare them in `~/.vishu/config.json`, each with its own model:

```json
{ "providers": {
    "claude": { "type": "anthropic", "apiKeys": ["sk-ant-…"], "model": "claude-opus-4-…" },
    "gpt":    { "type": "openai",    "apiKeys": ["sk-…"],     "model": "gpt-4o" },
    "local":  { "type": "ollama",    "baseUrl": "http://127.0.0.1:11434", "model": "llama3.2" }
} }
```

## What's inside

The agent has the tools you'd expect — `read/write/list`, `run_shell`, `web_fetch/search`, a persistent terminal, code-graph retrieval — all behind a `SecurityPolicy` (command classification, path jail, prompt-injection guard, sandbox backends). Around it: self-verification + git-worktree checkpoints/undo, risk-scoped approvals, a cost meter with a budget cap, the owned-markdown memory vault, the Arbor orchestration engine (hypothesis tree, subagents in isolated worktrees), test-time-compute amplifiers (`vishu eval` scores them), and an MCP client. Optional modules (wallet, voice, imagegen, desktop, …) stay off behind `VISHU_MODULES` and can't crash the core. A React/PWA frontend and a Rust/Tauri harness speak the same `vishu.*` JSON-RPC contract.

## Benchmarks

Honest and small for now: a built-in 8-task suite (4 easy + 4 hard) on **NVIDIA NIM `llama-3.1-8b-instruct`**.

| Runner | Pass rate | |
|---|---|---|
| `baseline` (single call) | 63% (5/8) | misses CRT bat-and-ball, two-leg distance, letter-count |
| `effort` (difficulty-routed) | 63% (5/8) | best-of-N fixes variance, not bias — ties baseline |
| `moa` (multi-agent ensemble) | **75% (6/8)** | **recovers two hard tasks single-shot misses** |

The lesson: self-consistency fixes variance, the multi-perspective ensemble fixes some bias. This is a reasoning probe, not a coding benchmark. For the real thing, `pnpm vishu eval swebench [--limit N]` runs the agent over **SWE-bench Lite** and writes a `predictions.jsonl`; scoring delegates to the official `swebench` harness (Docker + Python) rather than a homegrown scorer — the command prints the exact `run_evaluation` invocation when it finishes. Run the reasoning suite with `pnpm vishu eval <runner>` (`VISHU_EVAL_CONCURRENCY=1` on a single rate-limited key).

## Configuration

All config is file + `VISHU_*` env (see `.env.example`). The ones that matter:

| Var | Purpose |
|---|---|
| `VISHU_API_KEY` / `VISHU_API_KEYS` | provider key(s); a comma-list rotates or balances |
| `VISHU_KEY_MODE` | `failover` (default) / `balance` / `local` |
| `VISHU_PROVIDER` | provider or preset — auto-detected from the key if unset |
| `VISHU_MODEL` / `VISHU_BASE_URL` | override model + endpoint |
| `VISHU_MODULES` | comma-list of optional modules to enable |

Secrets live in env or the OS keychain — never in the vault, never in the model context.

## Security posture

`pnpm audit`: 0 known vulnerabilities. No secrets in source or git history; `.env` is gitignored. SQL is parameterized; the frontend has no XSS sink. The transport is loopback-bound with a per-launch bearer token + CORS allowlist. Shell/file execution is gated by `SecurityPolicy`; `workspace_dir` is never agent-writable. *(AI-assisted audit — not a substitute for a professional pentest.)*

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

Core is TypeScript/Node 24. Python (whisper sidecar) and Rust (Tauri harness) sit at subsystem boundaries over stdio/RPC — the right language per job.

## License

[MIT](LICENSE) © 2026 srimanrutvik224
