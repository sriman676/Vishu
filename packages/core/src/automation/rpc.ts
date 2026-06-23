import { err, ok, type Registry } from "../transport/rpc.js";
import type { TriggerManager, Trigger } from "./triggers.js";
import type { WorkflowStore, Workflow } from "./workflows.js";

/** Expose automation over `vishu.automation_*`: save workflows, register triggers, inspect state. */
export function registerAutomation(registry: Registry, store: WorkflowStore, manager: TriggerManager): void {
  registry.register("vishu.automation_save_workflow", (params) => {
    const p = (params ?? {}) as Partial<Workflow>;
    if (!p.name || !Array.isArray(p.steps)) return err("invalid_params", "name and steps[] are required");
    store.save({ name: p.name, steps: p.steps.map(String) });
    return ok({ name: p.name });
  });

  registry.register("vishu.automation_add_trigger", (params) => {
    const p = (params ?? {}) as Partial<Trigger>;
    if (!p.id || !p.spec || !p.workflow) return err("invalid_params", "id, spec, and workflow are required");
    manager.add({ id: p.id, spec: p.spec, workflow: p.workflow });
    return ok({ id: p.id });
  });

  registry.register("vishu.automation_list", () => ok({ workflows: store.list(), triggers: manager.list() }));
}
