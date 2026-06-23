import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type JsonRpcResponse } from "./rpc.js";

/** Read the bearer token: VISHU_CORE_TOKEN env wins, else the core.token file in the workspace. */
export function readToken(workspaceDir: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.VISHU_CORE_TOKEN) return env.VISHU_CORE_TOKEN;
  return readFileSync(join(workspaceDir, "core.token"), "utf8").trim();
}

/** Minimal JSON-RPC client used by the CLI to round-trip a method against a running core. */
export async function rpcCall(
  baseUrl: string,
  token: string,
  method: string,
  params?: unknown,
): Promise<JsonRpcResponse> {
  const res = await fetch(`${baseUrl}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok && res.status === 401) throw new Error("[rpc] unauthorized — token mismatch");
  return (await res.json()) as JsonRpcResponse;
}
