import type { ToolSchema } from "../providers/types.js";
import type { SecurityPolicy } from "../security/policy.js";
import type { Terminal } from "./terminal.js";

export interface ToolContext {
  policy: SecurityPolicy;
  terminal: Terminal;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export function toSchema(tool: Tool): ToolSchema {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}
