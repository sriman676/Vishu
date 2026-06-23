/** Canonical inbound envelope every channel normalizes into (blueprint doc 09). */
export interface InboundMessage {
  channel: string; // "email" | "slack" | "telegram" | ...
  from: string;
  text: string;
  id?: string;
  ts?: string;
}

/** Triage tiers: how much attention an inbound message needs. */
export type Tier = "skip" | "info" | "urgent" | "needs_action";

export interface TriageResult {
  summary: string;
  tier: Tier;
}

/** A chat/email channel: normalizes inbound (done upstream) and dispatches outbound replies. */
export interface Connector {
  readonly channel: string;
  send(to: string, text: string): Promise<void>;
}
