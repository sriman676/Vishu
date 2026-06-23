import type { Registry } from "../transport/rpc.js";
import type { EventBus } from "../transport/events.js";
import type { ToolRegistry } from "../tools/registry.js";

/** What a module may wire into the core when it is enabled. A module only ever *adds* — it never
 * touches the core's existing tools/RPC, so the core behaves identically when the module is off. */
export interface ModuleContext {
  tools: ToolRegistry;
  rpc: Registry;
  bus: EventBus;
  workspaceDir: string;
}

/** A Phase 12 optional module: off by default, enabled by name via `VISHU_MODULES`. */
export interface VishuModule {
  name: string;
  setup(ctx: ModuleContext): void | Promise<void>;
}

/** Modules the operator turned on, from `VISHU_MODULES` (comma-separated). Empty/unset = none. */
export function enabledModules(env = process.env): Set<string> {
  return new Set(
    (env.VISHU_MODULES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Set up only the enabled modules; return their names. A module that throws is logged and skipped —
 * an optional module must never take down the core (the "never block the core" guarantee). */
export async function loadModules(modules: VishuModule[], ctx: ModuleContext, enabled = enabledModules()): Promise<string[]> {
  const on: string[] = [];
  for (const m of modules) {
    if (!enabled.has(m.name)) continue;
    try {
      await m.setup(ctx);
      on.push(m.name);
    } catch (e) {
      process.stderr.write(`[modules] ${m.name} failed to load: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  return on;
}
