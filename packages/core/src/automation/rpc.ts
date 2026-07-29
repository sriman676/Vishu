import type { Autonomy } from "../reliability/approvals.js";
import { shellValidator } from "../reliability/verify.js";
import { type Terminal, sandboxedTerminal } from "../tools/terminal.js";
import type { EventBus } from "../transport/events.js";
import { err, ok, type Registry } from "../transport/rpc.js";
import { autoFixPass } from "./autofix.js";
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

export interface AutofixDeps {
  /** Where the validator command runs (the agent's action directory). */
  actionDir: string;
  /** Only fixes unattended at `automatic`; otherwise the failure is parked for approval. */
  autonomy: Autonomy;
  /** Performs the fix — an agent turn handed the failure output. */
  runAgent: (prompt: string) => Promise<string>;
  bus?: EventBus;
  /** Terminal factory — defaults to the auto-sandboxed one; tests inject a hermetic `new Terminal(dir)`
   * so the validator command doesn't containerize (Docker-up runners would otherwise pull an image). */
  makeTerminal?: (cwd: string) => Terminal;
}

/** Expose the backend error auto-fix loop over `vishu.autofix` — its poke source (a manual RPC call, or
 * a Phase 9 file/cron trigger calling it). Runs a shell command; on failure, dispatches a bounded
 * agent fix loop and re-verifies. The deterministic command exit code is the gate, never an LLM verdict. */
export function registerAutofix(registry: Registry, deps: AutofixDeps): void {
  registry.register("vishu.autofix", async (params) => {
    const p = (params ?? {}) as { command?: string; maxAttempts?: number };
    if (!p.command) return err("invalid_params", "command is required");
    const command = p.command;
    const terminal = (deps.makeTerminal ?? sandboxedTerminal)(deps.actionDir);
    try {
      const result = await autoFixPass({
        validator: shellValidator(terminal, command),
        autonomy: deps.autonomy,
        maxAttempts: p.maxAttempts,
        fix: async (failure) => {
          await deps.runAgent(`The command \`${command}\` failed:\n${failure}\n\nFix the code in the action directory so it passes. Do not run unrelated tasks.`);
        },
        onParked: (output) => deps.bus?.publish({ domain: "system", type: "notification", payload: { kind: "autofix_parked", command, output: output.slice(0, 500) } }),
      });
      return ok(result);
    } finally {
      terminal.close();
    }
  });
}
