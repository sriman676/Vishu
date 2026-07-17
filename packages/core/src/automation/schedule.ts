import type { ToolRegistry } from "../tools/registry.js";
import type { TriggerManager } from "./triggers.js";
import type { WorkflowStore } from "./workflows.js";

/** id-safe slug for a task name (also the trigger id, so cancel_task can name it). */
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "task";
}

/**
 * Natural-language task scheduling over the existing TriggerManager (proposal #1): the LLM turns a
 * request like "every morning brief me" into a saved workflow + a recurring schedule trigger. Reuses the
 * durable trigger/run infra — this is just the agent-facing surface (schedule / list / cancel). Scheduled
 * runs still hit the F0 gate (send/spend/delete deny unattended), so a task can read/summarise/draft but
 * not fire irreversible side effects on its own.
 */
export function registerScheduleTools(registry: ToolRegistry, deps: { store: WorkflowStore; manager: TriggerManager }): void {
  registry.register({
    name: "schedule_task",
    meta: { action: "write" }, // creates a local recurring automation; reversible via cancel_task
    description:
      "Schedule a recurring task: saves a workflow (an ordered list of instruction steps, each run as an agent turn) and a repeating timer that runs it every `everyMinutes`. Returns the task id (use it with cancel_task). The task runs unattended but still hits the approval gate, so it cannot send/spend/delete without you.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "A short name for the task, e.g. 'morning brief'." },
        steps: { type: "array", items: { type: "string" }, description: "Ordered instruction steps to run each time." },
        everyMinutes: { type: "number", description: "How often to run, in minutes (must be > 0)." },
      },
      required: ["name", "steps", "everyMinutes"],
    },
    run: async (args) => {
      const name = String(args.name ?? "").trim();
      const steps = Array.isArray(args.steps) ? args.steps.map(String).filter((s) => s.trim()) : [];
      const everyMinutes = Number(args.everyMinutes);
      if (!name) return "error: a task name is required.";
      if (!steps.length) return "error: at least one step is required.";
      if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) return "error: everyMinutes must be a positive number.";
      const id = slug(name);
      deps.store.save({ name, steps });
      deps.manager.add({ id, spec: { type: "schedule", everyMs: Math.round(everyMinutes * 60_000) }, workflow: name });
      return `Scheduled "${name}" (id: ${id}) — runs every ${everyMinutes} min: ${steps.join(" → ")}. Cancel with cancel_task("${id}").`;
    },
  });

  registry.register({
    name: "list_tasks",
    meta: { action: "read" },
    description: "List scheduled/recurring tasks (id, what fires it, and which workflow it runs).",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const triggers = deps.manager.list();
      if (!triggers.length) return "No scheduled tasks.";
      return triggers
        .map((t) => {
          const when = t.spec.type === "schedule" ? `every ${Math.round(t.spec.everyMs / 60_000)} min` : t.spec.type === "event" ? `on ${t.spec.domain} event` : `on file change`;
          return `- ${t.id} — ${when} → workflow "${t.workflow}"`;
        })
        .join("\n");
    },
  });

  registry.register({
    name: "cancel_task",
    meta: { action: "write" }, // removes a local automation; reversible by re-scheduling
    description: "Cancel a scheduled task by id (from list_tasks). Stops it firing and forgets it across restarts.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async (args) => {
      const id = String(args.id ?? "").trim();
      if (!id) return "error: a task id is required.";
      return deps.manager.remove(id) ? `Cancelled task "${id}".` : `No task with id "${id}".`;
    },
  });
}
