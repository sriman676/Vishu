import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { handleSlackWebhook, parseSlackEvent, verifySlackSignature } from "./inbound-webhook.js";

const SECRET = "shhh";

/** Sign a body exactly the way Slack does, so the tests exercise the real HMAC path. */
function sign(body: string, ts: string): string {
  return "v0=" + createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");
}

test("verifySlackSignature accepts a genuine signature and rejects tampering/replay", () => {
  const now = 1_700_000_000_000;
  const ts = String(now / 1000);
  const body = `{"hello":"world"}`;
  const good = sign(body, ts);
  assert.equal(verifySlackSignature(SECRET, ts, body, good, now), true, "valid signature");
  assert.equal(verifySlackSignature(SECRET, ts, body + "x", good, now), false, "body tampered");
  assert.equal(verifySlackSignature("wrong", ts, body, good, now), false, "wrong secret");
  assert.equal(verifySlackSignature(SECRET, ts, body, good, now + 6 * 60 * 1000), false, "stale ts → replay blocked");
  assert.equal(verifySlackSignature(SECRET, ts, body, undefined, now), false, "missing signature");
});

test("parseSlackEvent handles challenge, user message, and ignores bots/subtypes", () => {
  assert.deepEqual(parseSlackEvent(`{"type":"url_verification","challenge":"abc"}`), { kind: "challenge", challenge: "abc" });
  assert.deepEqual(
    parseSlackEvent(`{"event":{"type":"message","user":"U1","text":"hi","ts":"1.2"}}`),
    { kind: "message", from: "U1", text: "hi", id: "1.2" },
  );
  assert.equal(parseSlackEvent(`{"event":{"type":"message","bot_id":"B1","text":"my own reply"}}`).kind, "ignore", "bot reply → ignore (no self-loop)");
  assert.equal(parseSlackEvent(`{"event":{"type":"message","subtype":"message_changed","text":"edit"}}`).kind, "ignore", "edit → ignore");
  assert.equal(parseSlackEvent("not json").kind, "ignore");
});

test("handleSlackWebhook is fail-closed and normalizes a message to a trigger payload", () => {
  const now = 1_700_000_000_000;
  const ts = String(now / 1000);
  const challengeBody = `{"type":"url_verification","challenge":"c123"}`;

  // bad signature → 401, never parsed, never a trigger
  const bad = handleSlackWebhook(SECRET, { "x-slack-request-timestamp": ts, "x-slack-signature": "v0=deadbeef" }, challengeBody, now);
  assert.equal(bad.status, 401);
  assert.equal(bad.trigger, undefined);

  // valid challenge → echo it back
  const chal = handleSlackWebhook(SECRET, { "x-slack-request-timestamp": ts, "x-slack-signature": sign(challengeBody, ts) }, challengeBody, now);
  assert.equal(chal.status, 200);
  assert.deepEqual(JSON.parse(chal.body), { challenge: "c123" });
  assert.equal(chal.trigger, undefined);

  // valid user message → trigger payload on channel slack
  const msgBody = `{"event":{"type":"message","user":"UBOSS","text":"deploy the site","ts":"9.9"}}`;
  const msg = handleSlackWebhook(SECRET, { "x-slack-request-timestamp": ts, "x-slack-signature": sign(msgBody, ts) }, msgBody, now);
  assert.equal(msg.status, 200);
  assert.deepEqual(msg.trigger, { channel: "slack", from: "UBOSS", text: "deploy the site", id: "9.9" });
});
