import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ToolRegistry } from "../tools/registry.js";

/** §11 browser task library (productizes the raw actuator, part of the `browser` module): reusable
 * "book / fill / confirm" recipes the agent can expand into a concrete plan and then run through the
 * existing gated browser_* tools. Crucially the library NEVER executes steps itself — `browser_task_plan`
 * only *returns* the ordered plan, so every consequential step still passes through the F0 send-gate via
 * browser_commit. That keeps the safety model intact while giving the agent repeatable flows.
 * ponytail: {{param}} string substitution over a JSON store — no branching/looping DSL, no headless
 * executor. Conditional steps + a live runner are the named upgrades and ride this same recipe shape. */

export interface TaskStep {
  tool: string;
  args: Record<string, string>;
  note?: string;
}
export interface BrowserTask {
  name: string;
  params: string[];
  steps: TaskStep[];
}

/** One seed recipe so the library is useful out of the box and documents the recipe shape. Site-specific
 * selectors are the user's to add; this shows the book/fill/confirm arc with the commit staying gated. */
const SEED: BrowserTask = {
  name: "job_apply",
  params: ["url", "name", "email"],
  steps: [
    { tool: "browser_open", args: { url: "{{url}}" }, note: "open the posting" },
    { tool: "browser_type", args: { text: "Name", value: "{{name}}" }, note: "fill the name field" },
    { tool: "browser_type", args: { text: "Email", value: "{{email}}" }, note: "fill the email field" },
    { tool: "browser_commit", args: { text: "Submit application" }, note: "gated — asks for typed SEND before submitting" },
  ],
};

/** Expand a recipe into a concrete, ordered plan by substituting `{{param}}` placeholders. Throws if a
 * declared param is missing OR a step references an unknown placeholder — fail fast, never hand back a
 * half-filled plan that would submit a form with a literal "{{email}}" in it. Pure + deterministic. */
export function expandTask(task: BrowserTask, params: Record<string, string>): TaskStep[] {
  const missing = task.params.filter((p) => !(p in params));
  if (missing.length) throw new Error(`missing params: ${missing.join(", ")}`);
  const sub = (s: string): string =>
    s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
      const v = params[k];
      if (v === undefined) throw new Error(`unknown placeholder: {{${k}}}`);
      return v;
    });
  return task.steps.map((st) => ({
    tool: st.tool,
    note: st.note,
    args: Object.fromEntries(Object.entries(st.args).map(([k, v]) => [k, sub(v)])),
  }));
}

/** Atomic JSON-backed recipe store, seeded with SEED on first use (mirrors DigitalTwin/AchievementStore). */
export class TaskLibrary {
  private tasks: Record<string, BrowserTask> = {};

  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) {
      this.tasks = JSON.parse(readFileSync(file, "utf8")) as Record<string, BrowserTask>;
    } else {
      this.tasks[SEED.name] = SEED;
      this.persist();
    }
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.tasks, null, 2));
    renameSync(tmp, this.file); // atomic: a crash mid-write never corrupts the library
  }

  get(name: string): BrowserTask | undefined {
    return this.tasks[name];
  }
  list(): BrowserTask[] {
    return Object.values(this.tasks);
  }
  save(task: BrowserTask): BrowserTask {
    this.tasks[task.name] = task;
    this.persist();
    return task;
  }
}

/** Wire the library over three tools. `browser_task_plan` returns the expanded plan for the agent to run
 * via the gated browser_* tools — it deliberately does not execute anything. */
export function registerBrowserTaskTools(tools: ToolRegistry, workspaceDir: string): void {
  const lib = new TaskLibrary(join(workspaceDir, "browser-tasks.json"));

  tools.register({
    name: "browser_task_list",
    meta: { action: "read" },
    description: "List saved browser task recipes (name + required params) for book/fill/confirm flows.",
    parameters: { type: "object", properties: {} },
    run: async () => JSON.stringify(lib.list().map((t) => ({ name: t.name, params: t.params, steps: t.steps.length }))),
  });

  tools.register({
    name: "browser_task_plan",
    meta: { action: "read" },
    description:
      "Expand a saved recipe into an ordered plan of browser steps (substituting params). Returns the plan " +
      "for you to run step-by-step via browser_open/type/click/commit — commits still ask for approval.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, params: { type: "object" } },
      required: ["name"],
    },
    run: async (a) => {
      const task = lib.get(String(a.name));
      if (!task) return `error(no_target): no recipe named "${a.name}" — use browser_task_list`;
      try {
        const params = (a.params ?? {}) as Record<string, string>;
        return JSON.stringify(expandTask(task, params));
      } catch (e) {
        return `error(no_target): ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });

  tools.register({
    name: "browser_task_save",
    meta: { action: "write" },
    description: "Save/overwrite a browser task recipe: { name, params: string[], steps: [{tool,args,note?}] }.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, params: { type: "array" }, steps: { type: "array" } },
      required: ["name", "params", "steps"],
    },
    run: async (a) => {
      const task = { name: String(a.name), params: (a.params ?? []) as string[], steps: (a.steps ?? []) as TaskStep[] };
      if (!task.steps.length) return "error(no_target): a recipe needs at least one step";
      lib.save(task);
      return `saved recipe "${task.name}" (${task.steps.length} steps, params: ${task.params.join(", ") || "none"})`;
    },
  });
}
