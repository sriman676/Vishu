# 13 — Tauri Shell (`app/src-tauri/`)

A thin desktop host. Its jobs: spawn/own the in-process Rust core, relay RPC, run the CEF
WebView, host platform integrations (scanners, screen capture, meeting audio/video), and
register deep links. **No business logic** lives here.

## Runtime: CEF (not WRY)

- The only supported runtime is **CEF** (Chromium Embedded Framework) via
  `tauri-runtime-cef`. CI, installers, and `cargo tauri dev` all run CEF.
- A `wry` feature exists as a fallback (`dev:wry`) but is not shipped.
- **Vendored `tauri-cli` is mandatory** — stock `@tauri-apps/cli` makes broken bundles.
  Live at `app/src-tauri/vendor/tauri-cef/crates/tauri-cli`. Ensure via
  `scripts/ensure-tauri-cli.sh` (`pnpm tauri:ensure`).

## Key modules

`core_process` (spawns/owns the core, holds `rpc_token`), `core_rpc` (relay),
`cdp` (Chrome DevTools Protocol), `cef_preflight`, `cef_profile`, `dictation_hotkeys`,
`file_logging`, `mascot_native_window`, `screen_capture`, `window_state`,
`meet_audio`/`meet_call`/`meet_video`, `fake_camera`, `webview_accounts`, `webview_apis`,
and per-provider scanners (`discord_scanner`, `slack_scanner`, `telegram_scanner`,
`whatsapp_scanner`, …).

## IPC commands (Tauri `invoke` surface)

`greet`, `write_ai_config_file`, `ai_get_config`, `ai_refresh_config`,
**`core_rpc_relay`** (the JSON-RPC proxy), **`core_rpc_token`**, `start_core_process`,
`restart_core_process`, window commands, and `aetheria_*` daemon helpers.

## Core lifecycle

```
Tauri setup → core_process spawns aetheria-core as a Tokio task
            → run_server_embedded_with_ready(rpc_token: Some(<per-launch hex>))
            → core signals EmbeddedReadySignal when serving
renderer    → core_rpc_token (reads bearer)  → core_rpc_relay (every RPC)
```

## CEF child webviews — the injection rule

Embedded provider webviews **must not** grow new JS injection:
- No new `.js` under `webview_accounts/`.
- No new `build_init_script` / `RUNTIME_JS` blocks.
- No CDP `Page.addScriptToEvaluateOnNewDocument`.
New behavior goes in **CEF handlers**, **CDP from scanner modules**, or **Rust-side IPC
hooks**. Legacy injection (gmail, linkedin, google-meet) is grandfathered but should shrink.

## Deep links

- Scheme `aetheria://`. Windows: registered via `tauri-plugin-deep-link::register_all`;
  verified in `deep_link_registration_check.rs`.
- macOS deep links require a built `.app` bundle (not `tauri dev`).

## Installers

Desktop builds produce `.dmg` (macOS), `.msi` (Windows), `.AppImage` + `.deb` (Linux).

## Contracts to preserve

- The shell never implements rules — it relays to the core.
- Per-launch bearer stays in-memory; never put it on the process env.
- Keep `socketService`/MCP transport aligned with the core socket (dual-socket sync).
