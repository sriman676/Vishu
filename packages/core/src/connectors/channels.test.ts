import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRequest, configured, tokenChannels, TokenChannelConnector, type ChannelCreds } from "./channels.js";

const full: ChannelCreds = {
  telegramToken: "tg-tok",
  slackToken: "xoxb-tok",
  twilioSid: "AC123",
  twilioToken: "tw-tok",
  twilioFrom: "+15550001111",
};

test("configured: reports only vendors with complete creds", () => {
  assert.deepEqual(configured({}), []);
  assert.deepEqual(configured({ telegramToken: "t" }), ["telegram"]);
  assert.deepEqual(configured({ twilioSid: "s", twilioToken: "t" }), []); // SMS needs a from-number too
  assert.deepEqual(configured(full), ["telegram", "slack", "sms"]);
});

test("buildRequest: telegram → bot sendMessage with chat_id/text", () => {
  const r = buildRequest("telegram", "12345", "hi", full)!;
  assert.equal(r.url, "https://api.telegram.org/bottg-tok/sendMessage");
  assert.deepEqual(JSON.parse(String(r.init.body)), { chat_id: "12345", text: "hi" });
});

test("buildRequest: slack → chat.postMessage with Bearer auth", () => {
  const r = buildRequest("slack", "C42", "yo", full)!;
  assert.equal(r.url, "https://slack.com/api/chat.postMessage");
  assert.equal((r.init.headers as Record<string, string>).authorization, "Bearer xoxb-tok");
  assert.deepEqual(JSON.parse(String(r.init.body)), { channel: "C42", text: "yo" });
});

test("buildRequest: sms → Twilio Messages with Basic auth + form body", () => {
  const r = buildRequest("sms", "+15559998888", "ping", full)!;
  assert.match(r.url, /Accounts\/AC123\/Messages\.json$/);
  const auth = (r.init.headers as Record<string, string>).authorization;
  assert.equal(auth, `Basic ${Buffer.from("AC123:tw-tok").toString("base64")}`);
  const body = new URLSearchParams(String(r.init.body));
  assert.equal(body.get("To"), "+15559998888");
  assert.equal(body.get("From"), "+15550001111");
  assert.equal(body.get("Body"), "ping");
});

test("buildRequest: unconfigured vendor → null; connector.send throws", async () => {
  assert.equal(buildRequest("telegram", "1", "x", {}), null);
  await assert.rejects(new TokenChannelConnector("telegram", {}).send("1", "x"), /not configured/);
});

test("send: posts the vendor request and throws on non-2xx", async () => {
  const calls: string[] = [];
  const okFetch = (async (url: string) => {
    calls.push(url);
    return { ok: true, status: 200, statusText: "OK" } as Response;
  }) as unknown as typeof fetch;
  await new TokenChannelConnector("telegram", full, okFetch).send("1", "hi");
  assert.equal(calls.length, 1);

  const badFetch = (async () => ({ ok: false, status: 401, statusText: "Unauthorized" }) as Response) as unknown as typeof fetch;
  await assert.rejects(new TokenChannelConnector("slack", full, badFetch).send("C1", "hi"), /401/);
});

test("tokenChannels: builds a connector per configured vendor from env", () => {
  const chans = tokenChannels({ VISHU_TELEGRAM_TOKEN: "t", VISHU_SLACK_TOKEN: "s" } as NodeJS.ProcessEnv);
  assert.deepEqual(chans.map((c) => c.channel), ["telegram", "slack"]);
});
