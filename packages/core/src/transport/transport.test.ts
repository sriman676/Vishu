import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildRegistry } from "./all.js";
import { initToken } from "./auth.js";
import { rpcCall } from "./client.js";
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
