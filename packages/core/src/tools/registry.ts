import type { ToolSchema } from "../providers/types.js";
import { classifyTool, type ActionClass } from "../security/actions.js";
import { toSchema, type Tool } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) throw new Error(`[tools] duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    return tool;
  }

  /** The tool's action class: its declared meta.action, else a name heuristic. Unknown tools
   * (never registered) fall back to the heuristic too — the gate must classify anything it's asked about. */
  getAction(name: string): ActionClass {
    return this.tools.get(name)?.meta?.action ?? classifyTool(name);
  }

  schemas(): ToolSchema[] {
    return [...this.tools.values()].map(toSchema);
  }
}
