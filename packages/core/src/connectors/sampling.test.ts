import assert from "node:assert/strict";
import { test } from "node:test";
import { McpClient } from "./mcp.js";

// A stub MCP server (node): replies to initialize, then sends a server-initiated sampling request.
const SAMPLING_SERVER = `let buf="";process.stdin.on("data",d=>{buf+=d;let i;while((i=buf.indexOf("\\n"))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line)continue;const m=JSON.parse(line);if(m.method==="initialize"){process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result:{}})+"\\n");process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:99,method:"sampling/createMessage",params:{messages:[{role:"user"}]}})+"\\n");}}});`;

test("mcp: a server-initiated sampling/createMessage is routed to the injected sampler", async () => {
  let resolveCalled!: () => void;
  const called = new Promise<void>((r) => (resolveCalled = r));
  let gotParams: unknown;
  const sampler = async (params: unknown) => {
    gotParams = params;
    resolveCalled();
    return { role: "assistant", content: { type: "text", text: "42" }, model: "stub" };
  };

  const client = new McpClient("node", ["-e", SAMPLING_SERVER], { sampler });
  await client.start();
  await called; // the client dispatched the server's request to our LLM seam
  assert.deepEqual(gotParams, { messages: [{ role: "user" }] });
  client.stop();
});
