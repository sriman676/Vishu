import type { ToolSchema } from "../providers/types.js";
import type { AskFn } from "../reliability/approvals.js";
import type { ActionClass } from "../security/actions.js";
import type { SecurityPolicy } from "../security/policy.js";
import type { Terminal } from "./terminal.js";

export interface ToolContext {
  policy: SecurityPolicy;
  terminal: Terminal;
  /** The human approval channel, threaded from the running loop. A tool that delegates (dispatch/
   * orchestrate) hands this to its subagents so their gated actions can request approval instead of
   * only being denied. Absent → subagents stay deny-only (fail-closed). */
  ask?: AskFn;
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
