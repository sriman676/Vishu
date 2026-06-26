import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildRegistry } from "./all.js";
import { initToken } from "./auth.js";
import { rpcCall } from "./client.js";
import { EventBus } from "./events.js";
import { startServer } from "./server.js";

test("health_snapshot round-trips over RPC with a valid token", async () => {
  const token = initToken(mkdtempSync(join(tmpdir(), "vishu-")));
  const server = await startServer(buildRegistry("9.9.9", 0), "127.0.0.1", 0);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const res = await rpcCall(base, token, "vishu.health_snapshot");
    assert.equal(res.result?.ok, true);
    assert.equal((res.result as { result: { status: string } }).result.status, "ok");

    const missing = await rpcCall(base, token, "vishu.nope");
    assert.equal(missing.error?.code, -32601);
  } finally {
    await server.close();
  }
});

test("CORS: preflight + allowed origin echoes headers; a disallowed origin gets none", async () => {
  const token = initToken(mkdtempSync(join(tmpdir(), "vishu-")));
  const server = await startServer(buildRegistry("9.9.9", 0), "127.0.0.1", 0, undefined, ["tauri://localhost"]);
  try {
    const base = `http://127.0.0.1:${server.port}`;

    // Preflight from the packaged webview origin → 204 with the allow headers.
    const pre = await fetch(`${base}/rpc`, { method: "OPTIONS", headers: { origin: "tauri://localhost" } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "tauri://localhost");
    assert.match(pre.headers.get("access-control-allow-headers") ?? "", /authorization/);

    // Actual POST from the allowed origin → response carries the allow-origin header.
    const ok = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin: "tauri://localhost" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "vishu.health_snapshot" }),
    });
    assert.equal(ok.headers.get("access-control-allow-origin"), "tauri://localhost");

    // A different origin is not on the allowlist → no CORS header (browser would block it).
    const bad = await fetch(`${base}/rpc`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    assert.equal(bad.headers.get("access-control-allow-origin"), null);
  } finally {
    await server.close();
  }
});

test("SSE /events streams bus events to an authenticated client and rejects without a token", async () => {
  const token = initToken(mkdtempSync(join(tmpdir(), "vishu-")));
  const bus = new EventBus();
  const server = await startServer(buildRegistry("9.9.9", 0), "127.0.0.1", 0, bus);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    assert.equal((await fetch(`${base}/events`)).status, 401); // no token

    const res = await fetch(`${base}/events?token=${token}`);
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    bus.publish({ domain: "tool", type: "sync", payload: { server: "x", tools: ["x__a"] } });
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /"type":"sync"/);
    await reader.cancel();
  } finally {
    await server.close();
  }
});

test("requests without a valid bearer are rejected", async () => {
  initToken(mkdtempSync(join(tmpdir(), "vishu-")));
  const server = await startServer(buildRegistry("9.9.9", 0), "127.0.0.1", 0);
  try {
    await assert.rejects(
      rpcCall(`http://127.0.0.1:${server.port}`, "wrong-token", "vishu.health_snapshot"),
      /unauthorized/,
    );
  } finally {
    await server.close();
  }
});
