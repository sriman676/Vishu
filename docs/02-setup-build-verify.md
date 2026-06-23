# 02 — Setup, Build & Verify ("how the project is checked")

## Prerequisites

- **Rust** (edition 2021 toolchain; repo pins via `rust-toolchain` if present, else stable MSVC on Windows).
- **Node** >= 24, **pnpm** (root enforces pnpm; `corepack enable`).
- **Vendored CEF-aware `tauri-cli`** — the stock `@tauri-apps/cli` produces broken bundles.
  Install the vendored one:
  ```bash
  cargo install --locked --path app/src-tauri/vendor/tauri-cef/crates/tauri-cli
  ```
- Platform build deps for Tauri/CEF (Chromium Embedded Framework).
- macOS Apple Silicon: `GGML_NATIVE=OFF` for whisper-rs/llama.cpp.

## Environment files

- `.env.example` (root) → core, Tauri shell, backend URL, logging. Load with
  `source scripts/load-dotenv.sh`.
- `app/.env.example` → `VITE_*` vars. Copy to `app/.env.local`.
- Frontend config is centralized in `app/src/utils/config.ts` — **never** read
  `import.meta.env` directly elsewhere.
- Rust config: a TOML `Config` struct (`src/aetheria/config/schema/types.rs`) with env
  overrides (`load.rs`).

Key env vars: `AETHERIA_CORE_TOKEN`, `AETHERIA_CORE_PORT`, `AETHERIA_CORE_HOST`,
`AETHERIA_CORE_REUSE_EXISTING`, `AETHERIA_WORKSPACE`, `AETHERIA_ACTION_DIR`,
`AETHERIA_APPROVAL_GATE`, `AETHERIA_DISABLE_CHANNEL_LISTENERS`.

## Build & run commands (from repo root)

```bash
# Frontend
pnpm dev                 # Vite dev server only
pnpm dev:app             # Full Tauri desktop dev (CEF; loads env via scripts/load-dotenv.sh)
pnpm build               # Production UI build

# Rust core
cargo check  --manifest-path Cargo.toml
cargo build  --manifest-path Cargo.toml --bin aetheria-core
cargo check  --manifest-path app/src-tauri/Cargo.toml     # or: pnpm rust:check

# Standalone core (debugging)
./target/debug/aetheria-core serve     # token at {workspace}/core.token
#   public endpoints: GET /health, GET /schema, GET /events
```

## How files are checked (verification workflow)

| Check | Command | What it verifies |
| --- | --- | --- |
| Rust compile | `cargo check --manifest-path Cargo.toml` | lib + bins resolve & typecheck (NOT test code) |
| Rust + tests | `cargo check --tests` / `cargo test` | also compiles `#[cfg(test)]` + `tests/*` |
| TS typecheck | `pnpm typecheck` (`tsc --noEmit`) | frontend types |
| Lint | `pnpm lint` (ESLint --cache) | JS/TS lint |
| Format | `pnpm format` / `pnpm format:check` | Prettier + `cargo fmt` |
| Rust tests | `pnpm test:rust` / `bash scripts/test-rust-with-mock.sh --test <name>` | core behavior against mock backend |
| Unit (UI) | `pnpm test` / `pnpm test:coverage` | Vitest |
| E2E | WDIO specs in `app/test/e2e/specs/*.spec.ts` | desktop flows |
| i18n parity | `pnpm i18n:check`, `pnpm i18n:english:check` | locale key parity |

**Important gotcha**: plain `cargo check` does **not** compile test modules. Test-only
errors (missing imports in `#[cfg(test)] mod tests`) only surface with `cargo check --tests`.

**Coverage merge gate**: PRs need **≥ 80% coverage on changed lines** via `diff-cover` over
Vitest + `cargo-llvm-cov` lcov (`.github/workflows/coverage.yml`).

## Debug runners (`scripts/debug/`)

```bash
pnpm debug unit [file|-t name]   # Vitest
pnpm debug e2e <spec>            # WDIO
pnpm debug rust [filter]         # cargo tests
pnpm debug logs [last]           # recent logs (teed to target/debug-logs/)
```

## Environment pitfalls (learned the hard way)

- **Windows "paging file too small" (os error 1455)**: compiling 600k+ LOC needs lots of
  virtual memory. Increase the Windows paging file (System → Advanced → Performance →
  Virtual memory). Don't run `cargo` and rust-analyzer heavy compiles simultaneously.
- **Corrupted `target/` rmeta / mmap errors**: run `cargo clean`, restart rust-analyzer.
- **Vendored tauri-cli required** for any real desktop bundle (see prerequisites).
