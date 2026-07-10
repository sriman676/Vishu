import type { Router } from "../providers/router.js";
import type { ChatMessage } from "../providers/types.js";
import { ApprovalGate, type AskFn, type Autonomy } from "../reliability/approvals.js";
import type { RunLog } from "../reliability/runlog.js";
import type { AuditLog } from "../security/audit.js";
import type { SecurityPolicy } from "../security/policy.js";
import type { IdentityProfile } from "../personalization/profile.js";
import type { DigitalTwin } from "../personalization/twin.js";
import { runToolLoop } from "../tools/loop.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Terminal } from "../tools/terminal.js";
import { SessionStore } from "./session.js";

export interface AgentDeps {
  router: Router;
  tools: ToolRegistry;
  policy: SecurityPolicy;
  terminal: Terminal;
  model: string;
  runLog?: RunLog;
  /** Digital twin: records each user prompt so repeated tasks surface as workflow suggestions. */
  twin?: DigitalTwin;
  /** Cross-session identity profile: its notes load into the system prompt of each new session. */
  profile?: IdentityProfile;
  /** Active persona/mode (F12): its system prompt layers over the base so a mode switch actually
   * changes behaviour. Absent → the plain base persona. */
  mode?: { active(): { system: string } };
  /** How autonomously to act (default ask_every_time — the safe default). */
  autonomy?: Autonomy;
  /** How to ask the human for approval. Absent → deny gated actions (fail-closed: no UI = no unattended send/spend). */
  ask?: AskFn;
  /** Append-only decision log (UPGRADES §2). Absent → gate decisions aren't persisted. */
  audit?: AuditLog;
  /** Persist ask_once remembers here so they survive restart (UPGRADES §1). Absent → in-memory only. */
  rememberFile?: string;
  /** Persist the daily send counter here so the ≤N/day cap survives restart (UPGRADES §1 / F7). */
  sendCapFile?: string;
  /** Max send-class actions per day (default 30). */
  sendCap?: number;
}

export interface TurnResult {
  sessionId: string;
  final: string;
  iterations: number;
  turns: number;
}

const SYSTEM = "You are Vishu, a helpful coding agent. Use tools to build, run, and verify work inside the action directory.";

/** Drives full agent turns; backs the `vishu.agent_*` RPC surface. */
export class AgentService {
  private readonly gate: ApprovalGate;
  constructor(
    private readonly deps: AgentDeps,
    private readonly store = new SessionStore(),
  ) {
    // Fail-closed: with no approval UI wired, ask() denies — send/spend/delete/change_setting
    // never run unattended. Reads and safe writes still flow. Gate reads action class from the registry
    // and honours the global pause flag file by default.
    this.gate = new ApprovalGate(deps.autonomy ?? "ask_every_time", deps.ask ?? (async () => false), {
      actionOf: (name) => deps.tools.getAction(name),
      audit: deps.audit,
      rememberFile: deps.rememberFile,
      sendCapFile: deps.sendCapFile,
      sendCap: deps.sendCap,
    });
  }

  /** Base system prompt plus the user's identity profile (when non-empty) so the agent "knows you". */
  private systemPrompt(): string {
    const mode = this.deps.mode?.active().system;
    const base = mode ? `${SYSTEM}\n\n${mode}` : SYSTEM;
    const profile = this.deps.profile?.render();
    return profile ? `${base}\n\n${profile}` : base;
  }

  async startTurn(sessionId: string | undefined, message: string, model?: string): Promise<TurnResult> {
    const session = sessionId ? this.store.get(sessionId) : this.store.create(this.systemPrompt());
    this.deps.twin?.record(message); // auto-record: repeated prompts become suggestions, unattended
    session.messages.push({ role: "user", content: message });
    const result = await runToolLoop(
      {
        router: this.deps.router,
        registry: this.deps.tools,
        policy: this.deps.policy,
        terminal: this.deps.terminal,
        model: model ?? this.deps.model, // per-turn model override (UI model switcher); ignored under a pool
        runLog: this.deps.runLog,
        approve: (call) => this.gate.decide(call), // F0 gate — every tool call passes through here
        ask: this.deps.ask, // handed to delegating tools (dispatch) so their subagents can request approval
      },
      session.messages,
    );
    return { sessionId: session.id, final: result.final, iterations: result.iterations, turns: session.messages.length };
  }

  transcript(sessionId: string): ChatMessage[] {
    return this.store.get(sessionId).messages;
  }

  sessions() {
    return this.store.list();
  }
}
