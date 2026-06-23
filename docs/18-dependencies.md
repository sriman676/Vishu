# 20 — Dependency Pins

Verified from `Cargo.toml` (105 direct Rust deps) and `app/package.json`. Versions are the
live pins; bump as needed but keep the **roles** — these are load-bearing choices.

## Rust core (`Cargo.toml`) — key deps by role

| Role | Crates |
| --- | --- |
| Async runtime | `tokio` (full), `tokio-stream`, `futures-util` |
| HTTP server | `axum` 0.8, `tower` |
| HTTP client | `reqwest` (rustls) |
| TLS / WS | `rustls` 0.23, `rustls-pki-types`, `tokio-rustls`, `webpki-roots`, `tokio-tungstenite` (socket) |
| Socket.IO | `socketioxide` 0.15 |
| DB | `rusqlite` (SQLite) |
| Serde | `serde` 1, `serde_json`, `serde-big-array` (feature: whatsapp-web) |
| Schema | `schemars` 1.2 |
| Errors / log | `thiserror` 2, `anyhow`, `tracing`, `tracing-subscriber`, `tracing-appender`, `tracing-log`, `sentry` 0.47 |
| Encryption | `aes-gcm`, `argon2` (memory at rest) |
| Credentials | `keyring` 3 (apple/windows/linux native) |
| Config / paths | `toml` 1, `directories` 6, `dotenvy`, `iana-time-zone`, `chrono-tz` |
| Scheduling | `cron` 0.12 |
| Text / matching | `regex` 1.10, `aho-corasick` 1.1, `unicode-segmentation`, `unicode-width`, `unicode-normalization` |
| FS / sys | `walkdir`, `glob`, `fs2`, `sysinfo`, `hostname`, `starship-battery` |
| RPC codec | `prost` 0.14 |
| OAuth | `motosan-ai-oauth` 0.2 (codex) |
| Email | `lettre`, `mail-parser`, `async-imap` |
| Speech / audio | `whisper-rs` 0.16, `cpal`, `hound` |
| Desktop input | `enigo`, `arboard`, `rdev` |
| Images / docs | `image` 0.25, `pdf-extract` |
| Wallets / web3 | `ethers-core`, `ethers-signers`, `bitcoin` 0.32, `ed25519-dalek` 2, `bs58` 0.5, `ripemd` 0.1, `coins-bip39`, `curve25519-dalek` |
| Chat (matrix) | `matrix-sdk` 0.16 (optional) |
| Browser automation | `fantoccini` (optional, feature `browser-native`) |
| Misc | `urlencoding`, `url` 2, `tempfile` |

**Removed/redundant (drop on rebuild)**: `prometheus`, `shellexpand`, `ring` (rustls's
`ring` feature already provides crypto), `serde-big-array` only if you drop the
`whatsapp-web` feature. (`ripemd` kept — BTC/Tron address hashing.)

Workspace also vendors `tauri-cef` (CEF runtime + a patched `tauri-cli`).

## Frontend (`app/package.json`) — dependencies

```
@monaco-editor/react ^4.7.0   @noble/ciphers ^1.2.1   @noble/curves ^2.2.0
@noble/hashes ^2.0.1          @noble/secp256k1 ^3.0.0 @radix-ui/react-dialog ^1.1.15
@reduxjs/toolkit ^2.11.2      @remotion/player 4.0.454 @remotion/zod-types 4.0.454
@rive-app/react-webgl2 ^4.28.6 @scure/base ^2.2.0     @scure/bip32 ^2.0.1
@scure/bip39 ^2.0.1           @sentry/react ^10.38.0  @tauri-apps/api ^2.10.0
@tauri-apps/plugin-barcode-scanner ^2.4.4  @tauri-apps/plugin-deep-link ^2
@tauri-apps/plugin-opener ^2  @tauri-apps/plugin-os ^2.3.2  buffer ^6.0.3
cmdk ^1.1.1   d3-force ^3.0.0  debug ^4.4.3  katex ^0.16.47  lottie-react ^2.4.1
os-browserify ^0.3.0  pixi.js ^8.18.1  process ^0.11.10  qrcode.react ^4.2.0
react ^19.1.0  react-dom ^19.1.0  react-ga4 ^3.0.1  react-icons ^5.6.0
react-joyride ^3.1.0  react-markdown ^10.1.0  react-redux ^9.2.0
react-router-dom ^7.13.0  recharts ^2.15.0  redux-persist ^6.0.0
rehype-katex ^7.0.1  remark-math ^6.0.0  remotion 4.0.454  socket.io-client ^4.8.3
tauri-plugin-ptt-api workspace:*  three ^0.183.2  util ^0.12.5
xterm ^5.3.0  xterm-addon-fit ^0.8.0  zod 4.3.6
```

## Frontend — devDependencies (key)

```
typescript ~5.8.3  vite ^8.0.0  vitest ^4.0.18  @vitest/coverage-v8 ^4.0.18
@vitejs/plugin-react ^6.0.1  tailwindcss ^3.4.19  @tailwindcss/forms ^0.5.11
@tailwindcss/typography ^0.5.19  postcss ^8.5.6  autoprefixer ^10.4.23
eslint ^9.39.2  @typescript-eslint/* ^8.54.0  prettier ^3.8.1  husky ^9.1.7
knip ^6.3.1  jsdom ^28.0.0  @playwright/test ^1.56.1
@wdio/{cli,local-runner,mocha-framework,spec-reporter,appium-service} ^9.24.0
@testing-library/{react ^16.3.2, dom ^10.4.1, jest-dom ^6.9.1, user-event ^14.6.1}
@tauri-apps/cli 2.10.0  @sentry/vite-plugin ^2.22.6  vite-plugin-node-polyfills ^0.26.0
```

> Note: the stock `@tauri-apps/cli` is present for scripts, but real desktop bundles use the
> **vendored CEF tauri-cli** (see doc 13). Runtime requirements: Node >= 24, pnpm.
