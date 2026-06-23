import { createServer, type Server } from "node:http";
import { checkBearer } from "./auth.js";
import type { EventBus } from "./events.js";
import { type JsonRpcRequest, type Registry } from "./rpc.js";

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

async function readBody(req: import("node:http").IncomingMessage, limit = 1_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("payload too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Start the JSON-RPC + health HTTP server, bound to loopback only. */
export function startServer(registry: Registry, host: string, port: number, eventBus?: EventBus): Promise<RunningServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const send = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };

      // /health is unauthenticated liveness.
      if (req.method === "GET" && req.url === "/health") {
        return send(200, { ok: true, result: { status: "ok" } });
      }

      // /events: SSE realtime stream of bus events (tool:sync, notifications). Auth via ?token=.
      if (req.method === "GET" && req.url?.startsWith("/events")) {
        const token = new URL(req.url, "http://x").searchParams.get("token");
        if (!checkBearer(token ? `Bearer ${token}` : undefined)) return send(401, { error: "Unauthorized" });
        if (!eventBus) return send(404, { error: "no event bus" });
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.flushHeaders(); // send headers now so clients connect before the first event (no deadlock)
        const off = eventBus.subscribe((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
        req.on("close", off);
        return;
      }

      if (req.method !== "POST" || req.url !== "/rpc") {
        return send(404, { jsonrpc: "2.0", id: null, error: { code: -32601, message: "Not found" } });
      }

      if (!checkBearer(req.headers.authorization)) {
        return send(401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } });
      }

      let parsed: JsonRpcRequest;
      try {
        parsed = JSON.parse(await readBody(req)) as JsonRpcRequest;
      } catch {
        return send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
      send(200, await registry.handle(parsed));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: boundPort,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
            server.closeAllConnections?.(); // force-close keep-alive/SSE sockets so close() resolves
          }),
      });
    });
  });
}
