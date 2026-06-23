# 12 — Frontend (`app/src/`)

React 19 + TypeScript 5.8, built with Vite 7, styled with Tailwind. State in Redux Toolkit.
The UI **presents and orchestrates only** — all rules live in the Rust core.

## Provider chain (`App.tsx`)

```
Sentry.ErrorBoundary
 └ Redux Provider
   └ PersistGate
     └ BootCheckGate
       └ CoreStateProvider        ← auth lives here (fetchCoreAppSnapshot RPC)
         └ SocketProvider
           └ ChatRuntimeProvider
             └ HashRouter
               └ CommandProvider
                 └ ServiceBlockingGate
                   └ AppShell
```

There is **no** `UserProvider`/`AIProvider`/`SkillProvider` — auth is in `CoreStateProvider`.

## State (`store/`)

Redux Toolkit slices: `accounts`, `channelConnections`, `chatRuntime`, `coreMode`,
`deepLinkAuth`, `mascot`, `notification`, `providerSurface`, `socket`, `thread`.
Prefer Redux over ad-hoc `localStorage`. `redux-persist` for offline persistence.

## Services (`services/`)

`apiClient`, `socketService`, `coreRpcClient`, `coreCommandClient`, `chatService`,
`analytics`, `notificationService`, `webviewAccountService`, `daemonHealthService`, plus
domain `api/*` clients.

**Rule**: all core RPC goes through `invoke('core_rpc_relay', …)` / `coreRpcClient` — never
fetch the core directly.

## Routing (`AppRoutes.tsx`, HashRouter)

`/` (Welcome), `/onboarding/*`, `/home`, `/human`, `/intelligence`, `/skills`, `/chat`,
`/channels`, `/invites`, `/notifications`, `/rewards`, `/settings/*`.
(No `/login`, `/mnemonic`, `/agents`, `/conversations`.)

## Config & env

- Centralize in `app/src/utils/config.ts`. **Never** read `import.meta.env` elsewhere.
- `VITE_*` vars from `app/.env.local` (copy from `app/.env.example`).

## i18n (`app/src/lib/i18n/`)

- All UI text via `useT()` from `I18nContext`.
- Add the key to `en.ts` **and** real translations to every locale
  (`ar, bn, de, es, fr, hi, id, it, ko, pl, pt, ru, zh-CN`).
- CI enforces parity (`pnpm i18n:check`) + flags English placeholders (`pnpm i18n:english:check`).

## AI config / prompts

Bundled system prompts live in `src/aetheria/agent/prompts/` (also exposed as Tauri
resources). Frontend loaders in `app/src/lib/ai/` use `?raw` imports.

## Design tokens

Ocean primary `#4A83DD`; sage/amber/coral semantics; fonts Inter + Cabinet Grotesk +
JetBrains Mono. Tokens in `app/tailwind.config.js`.

## Hard rules

- **No dynamic imports** in production `app/src` — static `import`/`import type` only
  (exceptions: tests, `.d.ts`, config). Guard heavy paths with try/catch.
- **Tauri guard**: use `isTauri()` or wrap `invoke(...)` in try/catch — never check
  `window.__TAURI__` directly.
- File size ≤ ~500 lines preferred.
- Co-locate tests as `*.test.ts(x)`; Vitest config `app/test/vitest.config.ts`.

## Notable frontend deps (verified)

React 19.1, react-dom 19.1, @reduxjs/toolkit 2.11, react-redux 9.2, react-router-dom 7,
redux-persist 6, @tauri-apps/api 2.10 (+ plugins: deep-link, opener, os, barcode-scanner),
@sentry/react 10, @monaco-editor/react, recharts, react-markdown, katex, pixi.js, three,
@rive-app/react-webgl2, lottie-react, cmdk, qrcode.react, @noble/* + @scure/* (wallet crypto).
