/**
 * Live MCP smoke test (OPT-IN — kept OUT of `node --test` so the suite stays offline-safe).
 *
 * Proves Vishu's McpClient can connect to a REAL third-party MCP server end-to-end: spawns the
 * reference @modelcontextprotocol/server-everything over stdio, lists its tools, and calls `echo`.
 *
 * Run (needs network on first run to fetch the server via npx):
 *   VISHU_MCP_LIVE=1 npx tsx scripts/mcp-smoke.ts          (bash)
 *   $env:VISHU_MCP_LIVE=1; npx tsx scripts/mcp-smoke.ts    (PowerShell)
 */
import { McpClient } from "../packages/core/src/connectors/mcp.js";

if (process.env.VISHU_MCP_LIVE !== "1") {
  process.stdout.write("[mcp-smoke] skipped — set VISHU_MCP_LIVE=1 to run the live test (spawns a real npx server)\n");
  process.exit(0);
}

async function main(): Promise<void> {
  // McpClient handles the Windows bare-command (npx→cmd /c) quirk internally.
  const client = new McpClient("npx", ["-y", "@modelcontextprotocol/server-everything"]);
  try {
    await client.start();
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    process.stdout.write(`[mcp-smoke] server-everything tools: ${names.join(", ")}\n`);
    if (!names.includes("echo")) throw new Error(`expected an 'echo' tool, got: ${names.join(", ")}`);

    const marker = `vishu-${Date.now()}`;
    const out = await client.callTool("echo", { message: marker });
    process.stdout.write(`[mcp-smoke] echo returned: ${out}\n`);
    if (!out.includes(marker)) throw new Error(`echo did not round-trip the marker; got: ${out}`);

    process.stdout.write("[mcp-smoke] PASS — connected to a real MCP server and round-tripped a tool call\n");
  } finally {
    client.stop();
  }
}

main().catch((e) => {
  process.stderr.write(`[mcp-smoke] FAIL: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
