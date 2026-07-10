import type { ToolSchema } from "../providers/types.js";
import type { ActionClass } from "../security/actions.js";
import type { SecurityPolicy } from "../security/policy.js";
import type { Terminal } from "./terminal.js";

export interface ToolContext {
  policy: SecurityPolicy;
  terminal: Terminal;
}

/** Optional, authoritative metadata a tool declares about itself. */
export interface ToolMeta {
  /** What the tool DOES — the approval gate's primary signal (falls back to classifyTool by name). */
  action?: ActionClass;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  meta?: ToolMeta;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export function toSchema(tool: Tool): ToolSchema {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}
