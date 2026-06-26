import type { Router } from "../providers/router.js";
import type { ChatMessage, ToolCall } from "../providers/types.js";
import type { ApprovalDecision } from "../reliability/approvals.js";
import { estimateTokens, type Budget } from "../reliability/budget.js";
import type { RunLog } from "../reliability/runlog.js";
import type { SecurityPolicy } from "../security/policy.js";
import { compactTranscript } from "../tokenjuice/compact.js";
import { summarizeToolResult } from "../tokenjuice/summarize.js";
import type { ToolRegistry } from "./registry.js";
import type { Terminal } from "./terminal.js";

export interface ToolLoopResult {
  final: string;
  messages: ChatMessage[];
  iterations: number;
}

export interface ToolLoopDeps {
  router: Router;
  registry: ToolRegistry;
  policy: SecurityPolicy;
  terminal: Terminal;
  model: string;
  runLog?: RunLog;
  budget?: Budget;
  /** Risk-scoped approval gate; absent = auto-allow all. */
  approve?: (call: ToolCall) => Promise<ApprovalDecision>;
  /** Compact the transcript before each provider call (default true). */
  compact?: boolean;
}

/** provider → tool calls → execute (security + approval gated) → feed results back → repeat,
 * bounded. TokenJuice squeezes tool outputs + transcript; Budget can halt the run. */
export async function runToolLoop(
  deps: ToolLoopDeps,
  messages: ChatMessage[],
  maxIterations = 10,
): Promise<ToolLoopResult> {
  for (let i = 1; i <= maxIterations; i++) {
    const sent = deps.compact === false ? messages : compactTranscript(messages);
    const res = await deps.router.chat({ model: deps.model, messages: sent, tools: deps.registry.schemas(), category: "agent" });
    deps.budget?.charge(estimateTokens(sent.map((m) => m.content).join("\n")), estimateTokens(res.content));

    messages.push({ role: "assistant", content: res.content, toolCalls: res.toolCalls });
    deps.runLog?.log("assistant", res.content || `${res.toolCalls?.length ?? 0} tool call(s)`);

    if (!res.toolCalls?.length) return { final: res.content, messages, iterations: i };

    for (const call of res.toolCalls) {
      deps.runLog?.log("tool_call", `${call.name} ${JSON.stringify(call.arguments)}`);

      if (deps.approve) {
        const decision = await deps.approve(call);
        if (!decision.allowed) {
          const denied = `denied: ${decision.reason ?? "not approved"}`;
          deps.runLog?.log("tool_denied", `${call.name} ${denied}`);
          messages.push({ role: "tool", content: denied, toolCallId: call.id, name: call.name });
          continue;
        }
      }

      let output: string;
      try {
        output = await deps.registry.get(call.name).run(call.arguments, { policy: deps.policy, terminal: deps.terminal });
      } catch (e) {
        // ponytail: tool failure feeds back as an error message so the model can recover (fault isolation).
        output = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
      output = summarizeToolResult(output);
      deps.runLog?.log("tool_result", output.slice(0, 200));
      messages.push({ role: "tool", content: output, toolCallId: call.id, name: call.name });
    }
  }
  return { final: "[tool loop hit iteration cap]", messages, iterations: maxIterations };
}
