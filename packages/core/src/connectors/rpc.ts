import { err, ok, type Registry } from "../transport/rpc.js";
import { processDaily } from "./daily.js";
import { handleInbound, type InboundDeps } from "./triage.js";
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

  registry.register("vishu.connectors_send", async (params) => {
    const p = (params ?? {}) as { channel?: string; to?: string; text?: string };
    if (!p.channel || !p.to || !p.text) return err("invalid_params", "channel, to, and text are required");
    const connector = connectors?.get(p.channel);
    if (!connector) return err("not_found", `no connector for channel ${p.channel}`);
    await connector.send(p.to, p.text);
    return ok({ sent: true });
  });
}
