import type { MemoryStore } from "../memory/store.js";
import type { Router } from "../providers/router.js";
import type { RunLog } from "../reliability/runlog.js";
import type { EventBus } from "../transport/events.js";
import type { InboundMessage, Tier, TriageResult } from "./types.js";

const TIERS: Tier[] = ["skip", "info", "urgent", "needs_action"];

/** Parse the model's two-line triage reply; default to `info` so an odd reply never drops a message. */
export function parseTriage(text: string): TriageResult {
  const summary = /summary:\s*(.+)/i.exec(text)?.[1]?.trim() ?? text.trim().slice(0, 140);
  const raw = /tier:\s*([a-z_]+)/i.exec(text)?.[1]?.toLowerCase() as Tier | undefined;
  return { summary, tier: raw && TIERS.includes(raw) ? raw : "info" };
}

/** Ask the model to summarize + classify an inbound message. */
export async function triageMessage(router: Router, model: string, msg: InboundMessage): Promise<TriageResult> {
  const res = await router.chat({
    model,
    messages: [
      {
        role: "system",
        content:
          "Triage an inbound message. Reply with exactly two lines:\n" +
          "SUMMARY: <one sentence>\n" +
          "TIER: <skip|info|urgent|needs_action>",
      },
      { role: "user", content: `From ${msg.from} on ${msg.channel}:\n${msg.text}` },
    ],
    category: "connectors",
  });
  return parseTriage(res.content);
}

export interface InboundDeps {
  router: Router;
  model: string;
  memory: MemoryStore;
  bus: EventBus;
  runLog?: RunLog;
  /** Rendered identity profile so reply drafts sound like the user ("in your voice"). Optional. */
  voice?: string;
}

/** Inbound pipeline: triage → record a task/info note in the vault (skip is dropped) → notify on
 * urgent/needs_action via the same `system/notification` event the Phase 9 sink already delivers. */
export async function handleInbound(deps: InboundDeps, msg: InboundMessage): Promise<TriageResult> {
  const triage = await triageMessage(deps.router, deps.model, msg);
  deps.runLog?.log("inbound_triage", `${msg.channel}/${msg.from} → ${triage.tier}`);

  if (triage.tier !== "skip") {
    const actionable = triage.tier === "urgent" || triage.tier === "needs_action";
    await deps.memory.put({
      type: actionable ? "task" : "info",
      subject: `inbound-${msg.id ?? msg.ts ?? Date.now()}`,
      content: `Inbound from [[${msg.from}]] on ${msg.channel}: ${triage.summary}\n\n> ${msg.text}`,
    });
  }
  if (triage.tier === "urgent" || triage.tier === "needs_action") {
    deps.bus.publish({
      domain: "system",
      type: "notification",
      payload: { channel: msg.channel, from: msg.from, tier: triage.tier, summary: triage.summary },
    });
  }
  return triage;
}
