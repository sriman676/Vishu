# 10 — Config, Security, Credentials

## Config (`src/aetheria/config/`)

- TOML `Config` struct in `config/schema/types.rs`; env overrides in `config/schema/load.rs`.
- Loaded once at boot via `Config::load_or_init().await` (fail-loud).
- `config/ops.rs` + `config/schemas.rs` expose config-update RPCs
  (e.g. `config.update_autonomy_settings`).

**Two path roots** (critical security boundary):

- **`action_dir`** — the agent's read/write root. Acting tools resolve relative paths here.
  Default `~/Vishu/projects` (`VISHU_ACTION_DIR`).
- **`workspace_dir`** — internal state (`~/.vishu/users/<id>/workspace`). Agent tools
  **cannot** write here — enforced fail-closed by `is_workspace_internal_path` regardless of
  tier/trusted_roots.

### Config section reference (section → file)

The `Config` is composed of section structs, each in its own file under `config/schema/`.
Open the file for exact field names/defaults.

| Section | File | Configures |
| --- | --- | --- |
| root `Config` | `types.rs` | Composes all sections; `action_dir`/`workspace_dir` |
| env + load | `load.rs` | `load_or_init`, env precedence, timeouts |
| `[autonomy]` | `autonomy.rs` | SecurityPolicy tier + modifiers (see below) |
| `[agent]` | `agent.rs` | Harness models, iteration caps, prompt budget |
| `[tools]` | `tools.rs` | Tool enablement + per-tool config |
| `[storage]/[memory]` | `storage_memory.rs` | Memory store + chunking + search weights |
| cloud providers | `cloud_providers.rs` | Cloud LLM creds/endpoints |
| local AI | `local_ai.rs` | Ollama/local model settings |
| capability providers | `capability_providers.rs` | Capability routing |
| voice providers / server | `voice_providers.rs`, `voice_server.rs` | STT/TTS + voice server |
| `[channels]` | `channels.rs` | Channel config + listener toggles |
| `[proxy]` | `proxy.rs` | Network proxy |
| `[context]` | `context.rs` | Context-window assembly |
| `[learning]` | `learning.rs` | Learning/extraction |
| `[heartbeat]/[cron]` | `heartbeat_cron.rs` | Heartbeat + cron |
| `[identity]/[cost]` | `identity_cost.rs` | Identity + cost/budget |
| `[scheduler_gate]` | `scheduler_gate.rs` | Background throttle (battery/CPU); `mode` e.g. `always_on` |
| `[activity_level]` | `activity_level.rs` | Activity gating |
| `[dashboard]` | `dashboard.rs` | Dashboard |
| `[runtime]` / `[runtime_python]` / `[node]` | `runtime.rs`, `runtime_python.rs`, `node.rs` | Runtime flags + Python + managed Node |
| `[meet]` | `meet.rs` | Meetings |
| `[accessibility]`/`[autocomplete]`/`[dictation]` | `accessibility.rs`, `autocomplete.rs`, `dictation.rs` | A11y + autocomplete + dictation |
| `[observability]` | `observability.rs` | Logging/Sentry |
| `[update]` | `update.rs` | Self-update channel |
| `[task_sources]` | `task_sources.rs` | Task ingestion |
| `[claude_agent_sdk]` | `claude_agent_sdk.rs` | Claude Agent SDK provider |
| `[vault]`/`[routes]` | `vault.rs`, `routes.rs` | Vault watcher + routes |
| user state / defaults | `load_user_state.rs`, `defaults.rs` | Per-user load + defaults |

### Environment variables (override config)

Rename `AETHERIA_*` → `VISHU_*` for the new project (mechanical):
`*_WORKSPACE`, `*_ACTION_DIR`, `*_CORE_TOKEN`, `*_CORE_PORT`, `*_CORE_HOST`,
`*_CORE_REUSE_EXISTING`, `*_APPROVAL_GATE`, `*_DISABLE_CHANNEL_LISTENERS`,
plus `COMPOSIO_MODE_DIRECT`, `GGML_NATIVE` (build).

## Security policy (`src/aetheria/security/`)

The `[autonomy]` config block (`config/schema/autonomy.rs`) drives `SecurityPolicy`
(`security/policy.rs`):

- **Tiers**: `readonly` / `supervised` / `full`.
- Modifiers: `workspace_only`, `trusted_roots`, `allow_tool_install`.
- **Command classification**: `classify_command` → `CommandClass`
  (`Read`/`Write`/`Network`/`Install`/`Destructive`); unrecognized = `Write`.
  `gate_decision(class, tier)` → `Allow`/`Prompt`/`Block`.
- System/credential dirs are **unconditionally blocked** (`is_always_forbidden`).

### Approval gate (`src/aetheria/approval/`)

- ON by default (opt out: `VISHU_APPROVAL_GATE=0`).
- Parks interactive chat turns only; background/cron pass through.
- Frontend surfaces via `ApprovalRequestCard`. 10-min TTL → Deny.

### Sandbox backends (`src/aetheria/sandbox/`, `src/aetheria/cwd_jail/`)

Opt-in per agent (`sandbox_mode = "sandboxed"`):

- **Docker** (`sandbox/docker.rs`) — remote/cron.
- **Local OS jail** — Landlock (Linux), Seatbelt (macOS), AppContainer (Windows) — desktop.
- **Noop** fallback.
- In-Rust path hardening (`cwd_jail/`) applies regardless of backend.

### Prompt injection guard (`src/aetheria/prompt_injection/`)

User prompts are normalized + scored and enforced server-side (`allow | review | block`)
before any model/tool execution.

## Credentials & keyring (`src/aetheria/{credentials,keyring,keyring_consent,encryption}/`)

- **OS keychain** via `keyring` crate: macOS Keychain, Windows Credential Manager, Linux
  Secret Service. File-backend fallback for headless (`keyring/store.rs`).
- `keyring::init_master_key()` loads the master encryption key at boot (before any decrypt).
- `credentials/profiles.rs`, `credentials/session_support.rs` — user/session profiles;
  `sentry_scope::bind(uid)` for boot-time Sentry user binding.
- **Memory encryption**: AES-256-GCM + Argon2id (`encryption/`).
- **RPC auth**: per-launch bearer (in-memory) + `*_CORE_TOKEN` env + `core.token` file
  (0600). Public-bind without a token is refused / loudly warned.

## Auth handoff (web → desktop)

Single-use login tokens, 5-minute TTL, exchanged via the Rust HTTP client (bypasses CORS).

## Contracts to preserve

- `workspace_dir` is never agent-writable. Fail closed (`is_workspace_internal_path`).
- `[autonomy]` is the single source that drives `SecurityPolicy` — keep that wiring.
- `Config::load_or_init` is **fail-loud**: never silently fall back to a default workspace.
- All TLS via rustls. No secrets in logs or `localStorage`.
- Every executable tool runs through `SecurityPolicy` + the active sandbox backend.
