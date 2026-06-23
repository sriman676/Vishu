import type { Connector } from "./types.js";

/** A concrete in-process connector: outbound replies land in an in-memory outbox. Useful for tests,
 * CLI, and programmatic injection. Real channels (email/Slack/Telegram) implement the same Connector
 * interface with their API client. ponytail: the seam, not five API clients — add a channel when needed. */
export class LocalConnector implements Connector {
  readonly channel = "local";
  readonly outbox: { to: string; text: string }[] = [];

  async send(to: string, text: string): Promise<void> {
    this.outbox.push({ to, text });
  }
}
