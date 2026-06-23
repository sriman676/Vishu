# 22 — Branding & What Changes vs What Stays

The rebuild is **Vishu**, not Aetheria. The product identity and the entire frontend are
free to change; the **backend contracts are authoritative and should be preserved** (or
changed deliberately, not by accident).

## Rename map (mechanical find/replace)

| Old (source) | New (Vishu) |
| --- | --- |
| Product name "Aetheria" | "Vishu" (UI strings, README, about page) |
| RPC namespace `aetheria.*` | `vishu.*` (see doc 17) |
| Env prefix `AETHERIA_*` | `VISHU_*` |
| Crate name `aetheria` / lib `aetheria_core` | `vishu` / `vishu_core` (optional) |
| Bin `aetheria-core` | `vishu-core` (optional) |
| Workspace dir `~/.aetheria/...` | `~/.vishu/...` |
| Deep-link scheme `aetheria://` | `vishu://` |
| `core.token` file | unchanged name is fine |

> Renaming the RPC prefix and env prefix is a global find/replace at the registration sites +
> `load.rs`. Renaming the crate/bin touches `Cargo.toml`, `app/src-tauri` references, and
> staging paths (`app/src-tauri/binaries/`).

## ✅ Free to change (presentation layer)

- **Logo, icon, app name, splash** — `app/src-tauri/icons/`, window title, about page.
- **Design system** — colors, fonts, spacing, motion (the Ocean `#4A83DD` palette, Inter /
  Cabinet Grotesk, etc. are Aetheria's; pick your own).
- **Entire React frontend** (`app/src/`) — components, routes, Redux slices, screens. You may
  rebuild the UI from zero. The only hard requirement is it talks to the core the same way:
  `invoke('core_rpc_relay', { method: 'vishu.*', params })` + the realtime socket.
- **i18n locale set** — keep `useT()` pattern; choose your own languages.
- **Marketing copy, READMEs, store listings.**

## ⛔ Keep stable (or change on purpose, with care)

- **JSON-RPC method semantics** (doc 17) — params/returns the UI depends on.
- **The `core_rpc_relay` / `core_rpc_token` IPC bridge** (doc 13) — the only sanctioned
  frontend↔core path.
- **SecurityPolicy + sandbox + approval gate + prompt-injection guard** (doc 10) — never
  weaken these for convenience.
- **DB schema** (doc 11) — if you change tables, write a migration; don't silently drop.
- **Memory encryption** (AES-256-GCM + Argon2id) and **keychain** credential storage.
- **Dual-socket sync** behavior (doc 01) — keep frontend socket aligned with core socket.
- **`action_dir` vs `workspace_dir`** separation (doc 19) — the core security boundary.

## Practical rebuild stance

Treat this blueprint as: **backend = spec to re-implement faithfully; frontend = reference
to reinvent freely.** If you rebuild the UI fresh, you only need docs 01, 03, 10, 12 (as a
checklist of what the core expects), 13 (IPC bridge), and 17 (RPC catalog) to wire it up.

## Branding asset checklist (Vishu)

- [ ] App icon set (`.ico`, `.icns`, PNGs) in `app/src-tauri/icons/`
- [ ] Window title + product name in Tauri config + about page
- [ ] Splash / loading mascot assets
- [ ] New color tokens + fonts in `app/tailwind.config.js`
- [ ] Deep-link scheme `vishu://` registered (Windows registry + macOS bundle)
- [ ] Updated README / store metadata
