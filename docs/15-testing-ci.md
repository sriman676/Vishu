# 15 — Testing & CI

Testing philosophy: **tests before the next layer** — untested code is incomplete. Prefer
behavior over implementation; no real network; no time flakes.

## Test layers

| Layer | Tooling | Location |
| --- | --- | --- |
| Rust unit | `cargo test` | inline `#[cfg(test)] mod tests` or sibling `*_tests.rs` |
| Rust integration / E2E | `cargo test` + mock backend | `tests/*.rs` (e.g. `json_rpc_e2e.rs`) |
| Frontend unit | Vitest | co-located `*.test.ts(x)` under `app/src/**` |
| Desktop E2E | WDIO (dual platform) | `app/test/e2e/specs/*.spec.ts` |

## Commands

```bash
pnpm test                 # Vitest
pnpm test:coverage        # Vitest + coverage
pnpm test:rust            # scripts/test-rust-with-mock.sh
bash scripts/test-rust-with-mock.sh --test json_rpc_e2e   # one rust test
pnpm debug rust <filter>  # targeted rust tests with teed logs
```

## Shared mock backend

- Core: `scripts/mock-api-core.mjs` · Server: `scripts/mock-api-server.mjs` ·
  E2E: `app/test/e2e/mock-server.ts`.
- Admin endpoints: `GET /__admin/health`, `POST /__admin/reset`, `POST /__admin/behavior`,
  `GET /__admin/requests`.
- Manual: `pnpm mock:api`.

## E2E (WDIO)

- **Linux (CI)**: `tauri-driver` (WebDriver :4444).
- **macOS (local)**: Appium Mac2 (XCUITest :4723).
- Use helpers from `element-helpers.ts`; never raw `XCUIElementType*`.
- `e2e-run-spec.sh` creates/cleans a temp `AETHERIA_WORKSPACE` by default.
- Full guide: `gitbooks/developing/e2e-testing.md`.

## Coverage merge gate

PRs need **≥ 80% coverage on changed lines** via `diff-cover` over Vitest +
`cargo-llvm-cov` lcov. Enforced by `.github/workflows/coverage.yml`.

## Quality gates

- ESLint + Prettier + Husky. Pre-push hook runs `pnpm rust:check`.
- i18n parity (`pnpm i18n:check`) + English-placeholder detection (`pnpm i18n:english:check`).
- `cargo fmt --check` + Prettier check (`pnpm format:check`).

## Gotchas

- Plain `cargo check` skips test code — use `cargo check --tests` to catch test-only errors.
- Some heavy bootstrap tests are `#[ignore]`d (they spawn detached tasks + write
  process-global statics that leak into sibling tests); run with `-- --ignored` and ideally
  isolate in a dedicated `tests/` binary.
- Test fixtures should never hit real networks or real keychains; use the mock backend +
  temp workspaces + test guards (e.g. `SignedOutTestGuard`, `EnvVarGuard`).
