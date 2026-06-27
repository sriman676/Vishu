import type { Router } from "../providers/router.js";
import type { ChatMessage } from "../providers/types.js";
import type { RunLog } from "../reliability/runlog.js";
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
  constructor(
    private readonly deps: AgentDeps,
    private readonly store = new SessionStore(),
  ) {}

  /** Base system prompt plus the user's identity profile (when non-empty) so the agent "knows you". */
  private systemPrompt(): string {
    const profile = this.deps.profile?.render();
    return profile ? `${SYSTEM}\n\n${profile}` : SYSTEM;
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
