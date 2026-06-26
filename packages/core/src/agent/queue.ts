import type { TurnResult } from "./service.js";

export type TaskStatus = "queued" | "running" | "done" | "error";

export interface AgentTask {
  id: string;
  message: string;
  sessionId?: string;
  status: TaskStatus;
  result?: TurnResult;
  error?: string;
  enqueuedAt: number;
}

type RunTurn = (sessionId: string | undefined, message: string) => Promise<TurnResult>;

/** Agent-level task queue: enqueue agent turns and process them with bounded concurrency, so several
 * sessions make progress at once instead of blocking head-of-line. The streaming sibling of parallelMap
 * (open-ended pool vs. a fixed batch). Poll a task by id for its status/result.
 * ponytail: in-memory, FIFO, no persistence/priority/cancellation — add those when a caller needs them. */
export class AgentQueue {
  private readonly tasks = new Map<string, AgentTask>();
  private readonly pending: string[] = [];
  private running = 0;

  constructor(
    private readonly run: RunTurn,
    private readonly concurrency = 2,
  ) {}

  enqueue(message: string, sessionId?: string): AgentTask {
    const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const task: AgentTask = { id, message, sessionId, status: "queued", enqueuedAt: Date.now() };
    this.tasks.set(id, task);
    this.pending.push(id);
    this.pump();
    return task;
  }

  get(id: string): AgentTask | undefined {
    return this.tasks.get(id);
  }

  list(): AgentTask[] {
    return [...this.tasks.values()];
  }

  /** Start pending tasks until the in-flight count hits the concurrency limit. */
  private pump(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const task = this.tasks.get(this.pending.shift()!)!;
      task.status = "running";
      this.running += 1;
      void this.run(task.sessionId, task.message)
        .then((result) => {
          task.status = "done";
          task.result = result;
        })
        .catch((e) => {
          task.status = "error";
          task.error = e instanceof Error ? e.message : String(e);
        })
        .finally(() => {
          this.running -= 1;
          this.pump(); // a slot freed — pull the next pending task
        });
    }
  }
}
