# Contributing to Vishu

Thanks for considering a contribution. Vishu is a local-first, provider-agnostic coding agent — small, focused changes are easiest to review and merge.

## Setup

Only Node ≥ 24 is required; it provisions pnpm via corepack.

```bash
node setup.mjs        # install + build
pnpm -r test          # run the test suite
```

## Ground rules

- **Match the surrounding code.** Style, naming, and comment density should be indistinguishable from the file you're editing. No unused imports; no stray `console.log`.
- **One concern per PR.** Fix or add one thing. Don't refactor unrelated code in the same change.
- **Tests stay green and grow with behavior.** Non-trivial logic needs a test (`node:test` + `node:assert`, no extra frameworks). Run `pnpm -r test` before pushing.
- **Security gates are deterministic by design.** Don't replace a deterministic check (SAST, the maintainability gate) with an LLM verdict.
- **No new dependency for what a few lines can do.** Reach for the standard library and existing deps first.
- **Right language per job.** The core is TypeScript/Node; Python and Rust sit at subsystem boundaries over stdio/RPC. Use the best tool, not TS-only.

## Submitting

1. Fork and branch off `main`.
2. Make the change with a test; ensure `pnpm -r build` and `pnpm -r test` pass.
3. Open a PR describing *what* changed and *why*. CI runs the build + tests on every PR.

## Reporting bugs and security issues

Open a regular issue for bugs. For security vulnerabilities, follow [SECURITY.md](SECURITY.md) — please don't file those publicly.
