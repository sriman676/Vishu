# 09 — Channels, Integrations & MCP

How Aetheria talks to the outside world: chat channels, SaaS connectors (Composio), the
Model Context Protocol (tool surface), and webhooks.

## Channels (`src/aetheria/channels/`)

Provider integrations for chat platforms. `channels/providers/` holds one module per
provider: `web`, `telegram`, `discord`, `slack`, `whatsapp`, `irc`, email (lark/SMTP),
google-meet, etc. Each provider:

- Connects (often via the desktop-side scanner + CEF webview for account-based providers),
- Normalizes inbound messages into the canonical envelope,
- Dispatches outbound via the core.

`AETHERIA_DISABLE_CHANNEL_LISTENERS=1` disables listeners (used in tests).

## Composio (`src/aetheria/composio/`)

Composio is the external-tool/SaaS connector layer (Gmail, Slack, Notion, …). It exposes a
unified provider surface and periodic sync. Key bits:

- `composio/ops.rs` — connect, list toolkits, execute tool actions.
- `composio/providers/` — per-provider glue.
- `composio/trigger_history.rs` — trigger bookkeeping.
- `composio.mode` config toggle (e.g. `COMPOSIO_MODE_DIRECT`) selects execution path.
- Periodic sync persists `sync_state` via the global MemoryClient (kv_get/kv_set) — requires
  `memory::global` initialized.

## MCP (Model Context Protocol)

| Domain | Role |
| --- | --- |
| `mcp_client/` | Connect to external MCP servers, list/call their tools |
| `mcp_registry/` | Registry of MCP servers + their tools |
| `mcp_server/` | Expose Aetheria's own tools as an MCP server (`run_stdio_from_cli`) |
| `mcp_audit/` | Audit/security of MCP configs |
| `tool_registry/` | The unified tool registry MCP aggregates over |

MCP is JSON-RPC 2.0 over Socket.IO (`mcp:` event prefix, 30s timeout, pending-response map).
Tool names namespaced `skillId__toolName` for unambiguous routing. `tool:sync` broadcasts
the full inventory on connect + every tool/skill state change.

## Webhooks (`src/aetheria/webhooks/`)

Inbound webhook handling → `DomainEvent` on the `webhook` bus domain → subscribers react.

## Integrations (`src/aetheria/integrations/`)

Cross-cutting connector glue not tied to a single chat channel.

## Contracts to preserve

- All external HTTP goes through `reqwest` + `rustls` in the Rust core (bypasses browser CORS).
- Every tool the AI can call must appear in the unified tool registry and in `tool:sync`.
- Account-based providers use CEF webviews + scanners (desktop side) — **no new JS injection**
  (see doc 13); new behavior goes in CEF handlers / CDP / Rust IPC hooks.
