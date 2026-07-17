# MCP (Model Context Protocol)

Vishu speaks MCP both ways: it **connects out** to other MCP servers (client), and it can
**expose its own tools** to any MCP client (server). No token is required by default.

## Client — connect Vishu to other MCP servers

Set `VISHU_MCP_SERVERS` to a JSON array of `{id, cmd, args}`. Each server is spawned over stdio and
its tools register under `id__toolname`. A server that fails to start is logged and skipped — it can
never take down the core.

```jsonc
// PowerShell:  $env:VISHU_MCP_SERVERS = '[...]'
[
  { "id": "everything",  "cmd": "npx", "args": ["-y", "@modelcontextprotocol/server-everything"] },
  { "id": "fs",          "cmd": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\some\\dir"] }
]
```

Windows note: bare commands that resolve to a `.cmd`/`.bat` (`npx`, `npm`) are spawned through
`cmd /c` automatically — no `.cmd` suffix or wrapper needed.

Prove it end-to-end (opt-in, needs network once to fetch the server):

```powershell
$env:VISHU_MCP_LIVE = "1"; npx tsx scripts/mcp-smoke.ts
```

## Server — expose Vishu's tools to any MCP client

```powershell
vishu mcp-serve                 # stdio  — the client spawns Vishu (e.g. Claude Desktop)
vishu mcp-serve --http          # HTTP   — Streamable HTTP on http://127.0.0.1:8848
vishu mcp-serve --http 9000     # HTTP on a custom port
```

Every external tool call is routed through the **same ApprovalGate** the agent uses, wired
**fail-closed**: with no human present, `send`/`spend`/`delete`/`change_setting` are denied — an
external client can only ever drive reads and safe writes.

### Tokens are NOT required

- **stdio**: no token, ever.
- **HTTP**: open on `127.0.0.1` by default. A bearer token is required **only if** you set
  `VISHU_MCP_TOKEN`; leave it unset for a token-free endpoint.

```powershell
# optional hardening on a shared machine:
$env:VISHU_MCP_TOKEN = "some-secret"; vishu mcp-serve --http
# clients then send:  Authorization: Bearer some-secret
```

### Point Claude Desktop at Vishu (stdio, no token)

`claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "vishu": { "command": "node", "args": ["D:\\Job Project\\project vishu\\packages\\core\\dist\\bin\\vishu.js", "mcp-serve"] }
  }
}
```

### Check the HTTP endpoint is up

```powershell
curl -s http://127.0.0.1:8848/ -H "content-type: application/json" `
  -H "accept: application/json, text/event-stream" `
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

A real MCP client performs the full `initialize` handshake for you — the curl above is just a
liveness/smoke check.
