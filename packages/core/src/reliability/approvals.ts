import type { ToolCall } from "../providers/types.js";
import { classifyCommand, type CommandClass } from "../security/classify.js";

export type Autonomy = "ask_every_time" | "ask_once" | "automatic";

export interface ApprovalRequest {
  tool: string;
  summary: string;
  klass: CommandClass;
}

export interface ApprovalDecision {
  allowed: boolean;
  reason?: string;
}

export type AskFn = (req: ApprovalRequest) => Promise<boolean>;

/** Risk-scoped approvals: auto-allow reads + safe writes; only interrupt for risky shell actions.
 * Remembers decisions per tool when autonomy is ask_once. */
export class ApprovalGate {
  private readonly remembered = new Map<string, boolean>();
  constructor(
    private readonly autonomy: Autonomy,
    private readonly ask: AskFn,
  ) {}

  async decide(call: ToolCall): Promise<ApprovalDecision> {
    const klass = call.name === "run_shell" ? classifyCommand(String(call.arguments.command ?? "")) : "safe";

    // Only risky/irreversible actions need a human; everything else auto-allows.
    if (this.autonomy === "automatic" || klass === "safe") return { allowed: true };

    if (this.autonomy === "ask_once" && this.remembered.has(call.name)) {
      return { allowed: this.remembered.get(call.name)!, reason: "remembered" };
    }

    const ok = await this.ask({ tool: call.name, summary: JSON.stringify(call.arguments).slice(0, 200), klass });
    if (this.autonomy === "ask_once") this.remembered.set(call.name, ok);
    return { allowed: ok, reason: ok ? undefined : "user denied" };
  }
}
