import { err, ok, type Registry } from "../transport/rpc.js";
import type { AgentQueue } from "./queue.js";
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

/** Expose the agent task queue over `vishu.agent_queue_*` — fire-and-poll multitasking: enqueue a turn,
 * then poll the task id (or list all) for status/result. */
export function registerAgentQueue(registry: Registry, queue: AgentQueue): void {
  registry.register("vishu.agent_queue_enqueue", (params) => {
    const p = (params ?? {}) as { message?: string; sessionId?: string };
    if (!p.message) return err("invalid_params", "message is required");
    return ok(queue.enqueue(p.message, p.sessionId));
  });

  registry.register("vishu.agent_queue_task", (params) => {
    const p = (params ?? {}) as { id?: string };
    if (!p.id) return err("invalid_params", "id is required");
    const task = queue.get(p.id);
    return task ? ok(task) : err("not_found", `unknown task: ${p.id}`);
  });

  registry.register("vishu.agent_queue_tasks", () => ok(queue.list()));
}
