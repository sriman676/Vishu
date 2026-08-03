import { createHmac, timingSafeEqual } from "node:crypto";

/** Inbound webhook receiver — the trust boundary for a *vendor-hosted* endpoint (Slack Events API) that
 * can reach the remote-trigger. The vendor can't send our loopback bearer, so the request is
 * authenticated by the vendor's own request signature instead. A verified user message is normalized to
 * a `vishu.connectors_trigger` payload; the trigger stays fail-closed behind VISHU_TRIGGER_ALLOW on top
 * of this. Pure + HTTP-free so the security path is testable without a socket. */

/** Verify a Slack request signature. Slack signs `v0:{ts}:{rawBody}` with HMAC-SHA256 using the app
 * signing secret and sends the hex digest as `X-Slack-Signature: v0=…` + `X-Slack-Request-Timestamp`.
 * Reject a stale timestamp (>5 min skew) to kill replay, and timing-safe compare the digest. */
export function verifySlackSignature(
  secret: string,
  timestamp: string | undefined,
  rawBody: string,
  signature: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!secret || !timestamp || !signature) return false;
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(nowMs / 1000 - tsNum) > 300) return false; // replay window: 5 minutes
  const expected = "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return timingSafeEqual(a, b);
}

export type SlackParse =
  | { kind: "challenge"; challenge: string }
  | { kind: "message"; from: string; text: string; id?: string }
  | { kind: "ignore" };

/** Parse a Slack Events body: the url_verification handshake, a genuine user message, or something to
 * ignore. Bot/edited/subtype messages are ignored — a bot message includes our own replies, so acting
 * on them would loop the agent against itself. */
export function parseSlackEvent(rawBody: string): SlackParse {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { kind: "ignore" };
  }
  const b = body as { type?: string; challenge?: unknown; event?: Record<string, unknown> };
  if (b.type === "url_verification" && typeof b.challenge === "string") {
    return { kind: "challenge", challenge: b.challenge };
  }
  const ev = b.event;
  if (
    ev &&
    ev.type === "message" &&
    typeof ev.text === "string" &&
    ev.bot_id === undefined && // not a bot (incl. our own replies)
    ev.subtype === undefined // not an edit/join/etc.
  ) {
    return { kind: "message", from: typeof ev.user === "string" ? ev.user : "unknown", text: ev.text, id: typeof ev.ts === "string" ? ev.ts : undefined };
  }
  return { kind: "ignore" };
}

export interface WebhookResult {
  status: number;
  body: string;
  /** Present only for a verified user message: the payload to hand to `vishu.connectors_trigger`. */
  trigger?: { channel: string; from: string; text: string; id?: string };
}

/** Handle a raw Slack webhook POST end-to-end: verify signature → answer the challenge → normalize a
 * user message to a trigger payload. Fail-closed: a bad/stale signature is 401 and is never parsed as a
 * command. Ignored events are acked 200 so Slack doesn't retry them. */
export function handleSlackWebhook(
  secret: string,
  headers: { "x-slack-request-timestamp"?: string; "x-slack-signature"?: string },
  rawBody: string,
  nowMs: number = Date.now(),
): WebhookResult {
  if (!verifySlackSignature(secret, headers["x-slack-request-timestamp"], rawBody, headers["x-slack-signature"], nowMs)) {
    return { status: 401, body: JSON.stringify({ error: "bad signature" }) };
  }
  const parsed = parseSlackEvent(rawBody);
  if (parsed.kind === "challenge") return { status: 200, body: JSON.stringify({ challenge: parsed.challenge }) };
  if (parsed.kind === "message") {
    return { status: 200, body: JSON.stringify({ ok: true }), trigger: { channel: "slack", from: parsed.from, text: parsed.text, id: parsed.id } };
  }
  return { status: 200, body: JSON.stringify({ ok: true }) };
}
