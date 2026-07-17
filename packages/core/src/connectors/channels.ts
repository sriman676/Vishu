import { guardSendEgress } from "./egress-guard.js";
import type { Connector } from "./types.js";

/** §11h(ii) channels: Telegram / Slack / SMS outbound. Same fetch-POST spine as WebhookConnector — the
 * vendor specifics (endpoint, auth, payload shape) live in buildRequest. Tokens are stubbed via env; an
 * unconfigured channel throws on send (like StubMailConnector) rather than silently dropping. Inbound is
 * already covered: an upstream webhook receiver normalizes into InboundMessage → the `connectors_inbound`
 * RPC → triage, so no new inbound code is needed here. */

export type Vendor = "telegram" | "slack" | "sms";

export interface ChannelCreds {
  telegramToken?: string;
  slackToken?: string;
  twilioSid?: string;
  twilioToken?: string;
  twilioFrom?: string; // sender number for SMS
}

export function credsFromEnv(env: NodeJS.ProcessEnv = process.env): ChannelCreds {
  return {
    telegramToken: env.VISHU_TELEGRAM_TOKEN,
    slackToken: env.VISHU_SLACK_TOKEN,
    twilioSid: env.VISHU_TWILIO_SID,
    twilioToken: env.VISHU_TWILIO_TOKEN,
    twilioFrom: env.VISHU_TWILIO_FROM,
  };
}

/** Which vendors have complete credentials right now. */
export function configured(creds: ChannelCreds): Vendor[] {
  const out: Vendor[] = [];
  if (creds.telegramToken) out.push("telegram");
  if (creds.slackToken) out.push("slack");
  if (creds.twilioSid && creds.twilioToken && creds.twilioFrom) out.push("sms");
  return out;
}

/** Build the real vendor HTTP request for one outbound message, or null if that vendor isn't configured.
 * Pure (no network) so the auth/payload wiring is unit-testable without hitting the APIs. */
export function buildRequest(vendor: Vendor, to: string, text: string, creds: ChannelCreds): { url: string; init: RequestInit } | null {
  switch (vendor) {
    case "telegram":
      if (!creds.telegramToken) return null;
      return {
        url: `https://api.telegram.org/bot${creds.telegramToken}/sendMessage`,
        init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: to, text }) },
      };
    case "slack":
      if (!creds.slackToken) return null;
      return {
        url: "https://slack.com/api/chat.postMessage",
        init: {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${creds.slackToken}` },
          body: JSON.stringify({ channel: to, text }),
        },
      };
    case "sms": {
      if (!creds.twilioSid || !creds.twilioToken || !creds.twilioFrom) return null;
      const auth = Buffer.from(`${creds.twilioSid}:${creds.twilioToken}`).toString("base64");
      return {
        url: `https://api.twilio.com/2010-04-01/Accounts/${creds.twilioSid}/Messages.json`,
        init: {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${auth}` },
          body: new URLSearchParams({ To: to, From: creds.twilioFrom, Body: text }).toString(),
        },
      };
    }
  }
}

/** A real outbound connector for one vendor channel. `send` throws if the channel is unconfigured or the
 * vendor returns non-2xx, so a failed send surfaces instead of being dropped. */
export class TokenChannelConnector implements Connector {
  constructor(
    readonly channel: Vendor,
    private readonly creds: ChannelCreds = credsFromEnv(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(to: string, text: string): Promise<void> {
    const req = buildRequest(this.channel, to, text, this.creds);
    if (!req) throw new Error(`[${this.channel}] not configured — set the ${this.channel} token(s) in .env`);
    guardSendEgress(this.channel, req.url);
    const res = await this.fetchImpl(req.url, req.init);
    if (!res.ok) throw new Error(`[${this.channel}] send failed: ${res.status} ${res.statusText}`);
  }
}

/** Build a connector for each vendor whose credentials are present (tokens stubbed until then). */
export function tokenChannels(env: NodeJS.ProcessEnv = process.env): TokenChannelConnector[] {
  const creds = credsFromEnv(env);
  return configured(creds).map((v) => new TokenChannelConnector(v, creds));
}
