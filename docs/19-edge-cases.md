# 21 — Edge Cases & Failure Handling

The behaviors that make the system robust. These are easy to omit in a rebuild and painful
to rediscover. Grouped by subsystem. (Sourced from the core's error classifiers in
`core/observability.rs`, store circuit breakers, and the provider reliability layer.)

## Boot / config
- **Config load fails** (corrupt TOML, unwritable `AETHERIA_WORKSPACE`): do **not** fall back
  to `Config::default()` + default workspace — that causes chunk loss / cross-workspace
  bleed-over. Instead skip workspace-bound init, leave memory **uninitialized**, log loudly,
  let the server still come up. Callers get a clear "memory client not ready" error.
- **Config load timeout**: `load_config_with_timeout` wraps `load_or_init` in
  `tokio::time::timeout`; the literal `"Config loading timed out"` is a classified expected error.
- **Public bind without token**: refuse / loudly warn if binding a non-loopback host without
  an explicit RPC token (env, in-memory, or initialized).

## Storage (SQLite)
- **Per-path circuit breaker**: `get_or_init_connection` opens a breaker after too many
  consecutive init failures; emits `[memory_tree] circuit breaker open for <path>` instead of
  retrying forever. Surface as a classified error, not a crash.
- **`database is locked`** (SQLite code 5): transient lock contention — **retry**. Applies to
  WhatsApp ingest (`upsert wa_message`) and others.
- **`CANTOPEN` / IOERR_SHMMAP** (codes 14 / 4618, "unable to open the database file",
  "xshmmap"): host filesystem can't open the DB — treat as host failure (subconscious schema
  unavailable, etc.), classified, not a bug.
- **Disk full** ("no space left on device", "not enough space on the disk"): classified user-state error.

## Provider / inference
- **Transient upstream HTTP** (408, 429, 502, 503, 504, 520): retry + fallback in the
  reliability layer; do **not** Sentry-report per attempt (noise). Single source of truth:
  `TRANSIENT_PROVIDER_HTTP_STATUSES` in `core/observability.rs`.
- **Transient transport phrases**: "timeout", "operation timed out", "connection reset",
  "connection forcibly closed", "tls handshake eof", "error sending request" → transient.
- **Embedding backend auth failure** ("embedding api error" + 401 + "invalid token"): classified.
- **Empty provider response**: classified, handled (don't crash the turn).
- **Local AI capability unavailable**: classified, user-facing.
- **Budget exhausted**: user-state, not an error to report.

## Agent harness
- **Stack overflow risk**: a turn + nested subagent is a huge async state machine — Tokio
  workers need an enlarged stack (`AGENT_WORKER_STACK_BYTES`) or the process SIGABRTs
  ("thread 'tokio-rt-worker' has overflowed its stack"), taking the RPC server down mid-request.
- **Oversized tool results**: route through `PayloadSummarizer` (summarizer subagent);
  summarization failure is swallowed — never break a tool call because compression failed.
- **Max iterations**: bounded tool loop; max-iterations is a classified event, not a crash.
- **Malformed model output**: `self_healing.rs` recovers.
- **Interrupts**: a turn can be interrupted mid-flight (`interrupt.rs`); fences must not
  double-fire.

## Security / sandbox
- **Workspace-internal path write attempt**: fail closed via `is_workspace_internal_path`,
  regardless of tier or trusted_roots.
- **Always-forbidden dirs** (system/credential dirs): unconditionally blocked.
- **Unknown command class**: defaults to `Write` (the safer-gated class), never `Read`.
- **Approval gate timeout**: parked interactive turn auto-**denies** after 10-min TTL.
- **Prompt injection**: normalize + score server-side → `allow | review | block` before any
  model/tool execution.

## Channels / sync
- **Channel supervisor restart**: restart messages are classified (expected churn).
- **WhatsApp SQLite busy**: scoped retry only within the `[whatsapp_data] ingest failed:` +
  `upsert wa_message` envelope (don't demote unrelated DB failures).
- **Session expired**: classified; surfaced to UI for re-auth.
- **Socket**: reconnect with exponential backoff (1s→30s); ping/pong timeout ~50s.

## Updater
- **Updater transient HTTP** (403/500/502/503/504 from GitHub probes): expected network
  noise, scoped to updater domains — don't report.

## Platform
- **Windows paging file too small** (os error 1455): build/runtime needs adequate virtual
  memory; not a code bug.
- **Process spawn on Windows**: use `CommandExt` creation flags to suppress console windows
  for local model/voice subprocesses.

## Rule of thumb
Every external boundary (network, disk, DB, subprocess, model) needs: a transient-vs-fatal
**classifier**, a **retry** path for transient, and a **classified user-facing error** for
fatal — never an unhandled panic that takes the RPC server down.
