import { err, ok, type Registry } from "../transport/rpc.js";
import type { AgentService } from "./service.js";

/** Expose the agent over `vishu.agent_*`. Streaming deltas ride the event bus (Phase 14 socket);
 * here we surface start_turn + transcript + sessions, the round-trip a frontend needs. */
export function registerAgent(registry: Registry, service: AgentService): void {
  registry.register("vishu.agent_start_turn", async (params) => {
    const p = (params ?? {}) as { sessionId?: string; message?: string };
    if (!p.message) return err("invalid_params", "message is required");
    return ok(await service.startTurn(p.sessionId, p.message));
  });

  registry.register("vishu.agent_transcript", (params) => {
    const p = (params ?? {}) as { sessionId?: string };
    if (!p.sessionId) return err("invalid_params", "sessionId is required");
    return ok(service.transcript(p.sessionId));
  });

  registry.register("vishu.agent_sessions", () => ok(service.sessions()));
}
