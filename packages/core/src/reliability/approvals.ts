import type { ToolCall } from "../providers/types.js";
import { isPaused as defaultIsPaused } from "../automation/pause.js";
import { type ActionClass, classifyTool, NEVER_WITHOUT_ASKING } from "../security/actions.js";
import type { AuditLog } from "../security/audit.js";
import { classifyCommand, type CommandClass } from "../security/classify.js";

export type Autonomy = "ask_every_time" | "ask_once" | "automatic";

export interface ApprovalRequest {
  tool: string;
  summary: string;
  klass: CommandClass;
  action: ActionClass;
}

export interface ApprovalDecision {
  allowed: boolean;
  reason?: string;
}

export type AskFn = (req: ApprovalRequest) => Promise<boolean>;

export interface ApprovalOpts {
  /** Resolve a tool's action class (default: name heuristic; wire the ToolRegistry's getAction here). */
  actionOf?: (name: string) => ActionClass;
  /** Is the global pause engaged? (default: the flag-file check). Injected for tests. */
  isPaused?: () => boolean;
  /** Append-only decision log (UPGRADES §2). Absent → decisions aren't persisted. */
  audit?: AuditLog;
}

// Pausing must work even while paused, so the pause controls themselves are never pause-denied.
const PAUSE_EXEMPT = new Set(["jarvis_pause", "jarvis_resume"]);

/** Risk-scoped approvals with a hard floor:
 *  - send/spend/delete/change_setting ALWAYS ask (even automatic, even ask_once — no remembering).
 *  - while globally paused, every non-read action is denied (pause controls exempt).
 *  - otherwise: auto-allow reads + safe writes; interrupt only for risky shell. */
export class ApprovalGate {
  private readonly remembered = new Map<string, boolean>();
  private readonly actionOf: (name: string) => ActionClass;
  private readonly isPaused: () => boolean;
  private readonly audit?: AuditLog;
  constructor(
    private readonly autonomy: Autonomy,
    private readonly ask: AskFn,
    opts: ApprovalOpts = {},
  ) {
    this.actionOf = opts.actionOf ?? classifyTool;
    this.isPaused = opts.isPaused ?? defaultIsPaused;
    this.audit = opts.audit;
  }

  async decide(call: ToolCall): Promise<ApprovalDecision> {
    const action = this.actionOf(call.name);
    const decision = await this.evaluate(call, action);
    this.audit?.record({ kind: "gate", tool: call.name, action, verdict: decision.allowed ? "allow" : "deny", reason: decision.reason });
    return decision;
  }

  private async evaluate(call: ToolCall, action: ActionClass): Promise<ApprovalDecision> {
    const klass = call.name === "run_shell" ? classifyCommand(String(call.arguments.command ?? "")) : "safe";

    // Global pause: deny everything with a side effect. Reads and the pause controls pass.
    if (this.isPaused() && !PAUSE_EXEMPT.has(call.name) && action !== "read") {
      return { allowed: false, reason: "paused (global pause active)" };
    }

    // Hard floor: irreversible/outbound classes are always confirmed, per-call, regardless of autonomy.
    if (NEVER_WITHOUT_ASKING.has(action)) {
      const ok = await this.ask({ tool: call.name, summary: summarize(call), klass, action });
      return { allowed: ok, reason: ok ? undefined : "user denied" };
    }

    // Everything else: only risky shell needs a human; reads + safe writes auto-allow.
    if (this.autonomy === "automatic" || klass === "safe") return { allowed: true };

    if (this.autonomy === "ask_once" && this.remembered.has(call.name)) {
      return { allowed: this.remembered.get(call.name)!, reason: "remembered" };
    }

    const ok = await this.ask({ tool: call.name, summary: summarize(call), klass, action });
    if (this.autonomy === "ask_once") this.remembered.set(call.name, ok);
    return { allowed: ok, reason: ok ? undefined : "user denied" };
  }
}

function summarize(call: ToolCall): string {
  return JSON.stringify(call.arguments).slice(0, 200);
}
