# 08 — Inference & Providers (`src/aetheria/inference/`)

The inference layer abstracts LLM providers behind a factory and a reliability wrapper, with
both cloud and local backends.

## Structure

| Path | Role |
| --- | --- |
| `inference/provider/factory.rs` | Builds the active provider from config (the entry point) |
| `inference/provider/compatible.rs` | OpenAI-compatible chat API client (largest, ~121K) — request/stream/parse |
| `inference/provider/ops.rs` | Reliability: retries, fallback, transient-failure classification |
| `inference/provider/claude_code/` | Claude Code provider (with `input_builder.rs`) |
| `inference/provider/claude_agent_sdk/` | Claude Agent SDK provider |
| `inference/local/` | Local model service: Ollama admin (`service/ollama_admin.rs`), process utils |
| `inference/voice/` | Local speech/transcribe (whisper-rs); `local_speech.rs`, `local_transcribe.rs` |

## Provider contract

- A provider exposes chat (`chat` / `chat_with_system`) and streaming sinks
  (`make_stream_sink`). The factory returns a boxed/dyn provider chosen by config.
- The **reliability layer** (`ops.rs`) handles transient upstream HTTP failures
  (408/429/502/503/504/520) via retry + fallback, and classifies which failures are worth
  reporting to Sentry (`should_report_provider_http_failure`). The canonical status list
  lives in `core/observability.rs::TRANSIENT_PROVIDER_HTTP_STATUSES` — single source of truth.

## Local models

- **Ollama**: managed/admin in `inference/local/service/ollama_admin.rs`.
- **Whisper** (speech-to-text): `whisper-rs 0.16` via `inference/voice/`.
- macOS Apple Silicon: build whisper/llama with `GGML_NATIVE=OFF`.
- Process spawning uses platform-specific flags (Windows `CommandExt` for no-window).

## Capabilities & routing

- `routing/` (see doc 06) decides which provider/model to use and does quality checks on
  local-model output.
- Capability gating: "local AI capability unavailable" is a classified, user-facing error
  (see observability classifiers).

## Contracts to preserve

- Keep cloud + local behind the same provider trait so the harness is backend-agnostic.
- Centralize transient-status lists (don't duplicate the retry list across layers).
- Stream sinks must surface partial output incrementally to the UI.
