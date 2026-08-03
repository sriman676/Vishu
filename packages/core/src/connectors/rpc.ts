import { err, ok, type Registry } from "../transport/rpc.js";
import { buildBriefing, processDaily } from "./daily.js";
import { handleInbound, type InboundDeps } from "./triage.js";
import { triggerAllowed } from "./trigger.js";
import type { Connector } from "./types.js";

/** Expose connectors over `vishu.connectors_*`: inbound triage (normalize → triage → vault task +
 * notify) and outbound replies through a registered channel connector. */
export function registerConnectors(registry: Registry, deps: InboundDeps, connectors?: Map<string, Connector>): void {
  registry.register("vishu.connectors_inbound", async (params) => {
    const p = (params ?? {}) as { channel?: string; from?: string; text?: string; id?: string };
    if (!p.channel || !p.from || !p.text) return err("invalid_params", "channel, from, and text are required");
    return ok(await handleInbound(deps, { channel: p.channel, from: p.from, text: p.text, id: p.id }));
  });

  // §11a daily-driver: inbound email/message → triage + Matters-match + to-do + a filed reply draft
  // (never sent; approval + gated `connectors_send` follow). Same deps as inbound; a superset of it.
  registry.register("vishu.connectors_daily", async (params) => {
    const p = (params ?? {}) as { channel?: string; from?: string; text?: string; id?: string };
    if (!p.from || !p.text) return err("invalid_params", "from and text are required");
    return ok(await processDaily(deps, { channel: p.channel ?? "email", from: p.from, text: p.text, id: p.id }));
  });

  // §11h(iii): one-shot daily briefing over the day's filed signals (empty string = quiet day).
  registry.register("vishu.daily_briefing", async () => ok({ briefing: await buildBriefing(deps.memory, deps.router, deps.model) }));

  // Remote trigger: an inbound message runs the FULL agent (every mounted MCP tool, present and
  // future — the agent inherits them via DomainManager), then the agent's answer is sent back on the
  // same channel to the sender. One entrypoint, all MCPs. FAIL-CLOSED behind VISHU_TRIGGER_ALLOW —
  // an unauthorized sender is refused and logged, never run (see trigger.ts: remote-exec boundary).
  registry.register("vishu.connectors_trigger", async (params) => {
    const p = (params ?? {}) as { channel?: string; from?: string; text?: string; id?: string };
    if (!p.channel || !p.from || !p.text) return err("invalid_params", "channel, from, and text are required");
    if (!deps.runAgent) return err("unsupported", "agent runner not wired for triggers");
    if (!triggerAllowed(p.from)) {
      deps.runLog?.log("trigger_denied", `${p.channel}/${p.from}`);
      return err("forbidden", `sender ${p.from} not allowed — add to VISHU_TRIGGER_ALLOW`);
    }
    deps.runLog?.log("trigger_run", `${p.channel}/${p.from}: ${p.text.slice(0, 80)}`);
    const reply = await deps.runAgent(p.text);
    // Reply back to the (authenticated) sender on the origin channel; the connector's own egress guard
    // still applies. Best-effort — a send failure is logged but the reply is always returned to the caller.
    const connector = connectors?.get(p.channel);
    let replied = false;
    if (connector) {
      try {
        await connector.send(p.from, reply);
        replied = true;
      } catch (e) {
        deps.runLog?.log("trigger_reply_failed", `${p.channel}/${p.from}: ${(e as Error).message}`);
      }
    }
    return ok({ ran: true, replied, reply });
  });

  registry.register("vishu.connectors_send", async (params) => {
    const p = (params ?? {}) as { channel?: string; to?: string; text?: string };
    if (!p.channel || !p.to || !p.text) return err("invalid_params", "channel, to, and text are required");
    const connector = connectors?.get(p.channel);
    if (!connector) return err("not_found", `no connector for channel ${p.channel}`);
    await connector.send(p.to, p.text);
    return ok({ sent: true });
  });
}
