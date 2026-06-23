import assert from "node:assert/strict";
import { test } from "node:test";
import { WebhookConnector } from "./webhook.js";

test("webhook: POSTs {channel,to,text} and throws on non-2xx", async () => {
  const realFetch = globalThis.fetch;
  try {
    let body: any;
    let url: string | undefined;
    globalThis.fetch = (async (u: string, init: any) => {
      url = u;
      body = JSON.parse(init.body);
      return { ok: true, status: 200 };
    }) as never;

    const wh = new WebhookConnector("alerts", "http://hook.test/x");
    await wh.send("ops", "disk full");
    assert.equal(url, "http://hook.test/x");
    assert.deepEqual(body, { channel: "alerts", to: "ops", text: "disk full" });

    globalThis.fetch = (async () => ({ ok: false, status: 500, statusText: "boom" })) as never;
    await assert.rejects(new WebhookConnector("alerts", "http://hook.test/x").send("a", "b"), /500 boom/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
