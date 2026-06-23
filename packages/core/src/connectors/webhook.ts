import type { Connector } from "./types.js";

/** A real, credential-free outbound connector: POSTs `{ to, text }` as JSON to a configured webhook URL
 * (Slack/Discord incoming webhooks, Zapier, n8n, your own endpoint). This is the verifiable "real channel
 * client" — vendor connectors (Gmail/Telegram/Slack-API) implement the same `Connector` with their SDK +
 * creds at this seam. ponytail: one HTTP POST, no per-vendor auth; a non-2xx response throws so a failed
 * send surfaces instead of silently dropping. */
export class WebhookConnector implements Connector {
  constructor(
    readonly channel: string,
    private readonly url: string,
  ) {}

  async send(to: string, text: string): Promise<void> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: this.channel, to, text }),
    });
    if (!res.ok) throw new Error(`[webhook] ${this.channel} send failed: ${res.status} ${res.statusText}`);
  }
}
