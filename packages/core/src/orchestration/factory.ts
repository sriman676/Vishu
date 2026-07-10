import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ApprovalGate, type AskFn } from "../reliability/approvals.js";
import type { RunLog } from "../reliability/runlog.js";
import type { AuditLog } from "../security/audit.js";
import type { SkillIndex } from "../skills/index.js";
import type { ToolRegistry } from "../tools/registry.js";
import { type Archetype, synthesizeArchetype } from "./archetypes.js";

/** A capability keyword → the tool that would provide it. Drives the tool-wishlist: if a task/skill
 * asks for a capability whose tool the parent lacks, it is RECORDED (never silently granted).
 * ponytail: a static keyword table, not LLM-inferred caps — upgrade when the map misses real needs. */
const CAP_TOOLS: Record<string, string> = {
  email: "send_email",
  browse: "browser",
  browser: "browser",
  screenshot: "screen_capture",
  clipboard: "clipboard",
  calendar: "calendar_event",
  database: "db_query",
  voice: "voice_speak",
  speak: "voice_speak",
};

export interface AgentProposal {
  name: string;
  /** Drafted system prompt — cites the relevant skills and forbids agent-to-agent chaining. */
  system: string;
  /** Tools it MAY use now — always ⊆ parent (least privilege, from synthesizeArchetype). */
  tools: string[];
  /** Capabilities the cited skills imply but no current tool provides — recorded, never granted. */
  toolWishlist: string[];
  citedSkills: { name: string; description: string }[];
}

/** Draft a bespoke agent from a cited skills report. Deterministic (no LLM in V1: the "meta-prompt" is a
 * template over the task + cited skills). tools ⊆ parent by construction; the wishlist names missing caps.
 * ponytail: template draft — upgrade to an LLM-authored prompt when a task needs genuinely novel wording. */
export function proposeAgent(name: string, task: string, parent: ToolRegistry, skills: SkillIndex): AgentProposal {
  const citedSkills = skills.search(task, 5);
  const tools = synthesizeArchetype(task, parent).tools as string[];
  const have = new Set(parent.schemas().map((s) => s.name));
  const hay = `${task} ${citedSkills.map((c) => `${c.name} ${c.description}`).join(" ")}`.toLowerCase();
  const toolWishlist = [...new Set(Object.entries(CAP_TOOLS).filter(([kw, tool]) => hay.includes(kw) && !have.has(tool)).map(([, tool]) => tool))].sort();

  const skillLines = citedSkills.length ? citedSkills.map((c) => `- ${c.name}: ${c.description}`).join("\n") : "- (no matching skills indexed)";
  const wishLine = toolWishlist.length ? `\nMissing capabilities (request via the tool-wishlist; do not improvise): ${toolWishlist.join(", ")}.` : "";
  const system = [
    `You are a purpose-built agent for: ${task}`,
    ``,
    `Relevant skills (cited from the skill library — consult before acting):`,
    skillLines,
    ``,
    `Allowed tools: ${tools.join(", ") || "(read-only core)"}.${wishLine}`,
    `Do NOT orchestrate or spawn other agents. Any side-effecting action must pass the approval gate.`,
  ].join("\n");

  return { name, system, tools, toolWishlist, citedSkills };
}

/** The Trillion-style agent factory: propose a bespoke agent, gate its registration behind the F0
 * approval gate (registration is a change_setting — always asks), and keep approved agents in a live
 * store so they run WITHOUT a restart (hot). A store path persists them across restarts.
 * "No silent agent-to-agent chaining" is enforced structurally: a proposal is inert until
 * `approveAndRegister` clears the gate, the drafted prompt forbids spawning, and tools ⊆ parent (no
 * spawn tool exists to hand out). */
/** A registered agent, plus the wishlist recorded at proposal time so the human can later fulfil it
 * (grant a cap once the system actually exposes it). Extends Archetype, so any Archetype consumer works. */
export interface RegisteredAgent extends Archetype {
  /** Caps the cited skills implied but the parent lacked — surfaced by `list`, fulfilled by `grantTool`. */
  wishlist?: string[];
}

export class AgentFactory {
  private readonly approved = new Map<string, RegisteredAgent>();
  private readonly gate: ApprovalGate;

  constructor(
    private readonly parent: ToolRegistry,
    private readonly skills: SkillIndex,
    private readonly opts: { ask?: AskFn; audit?: AuditLog; storePath?: string; runLog?: RunLog } = {},
  ) {
    // Registration always counts as change_setting → the gate always asks, is pause-denied, and audited.
    this.gate = new ApprovalGate("automatic", opts.ask ?? (async () => false), { actionOf: () => "change_setting", audit: opts.audit });
    if (opts.storePath) this.load(opts.storePath);
  }

  propose(name: string, task: string): AgentProposal {
    return proposeAgent(name, task, this.parent, this.skills);
  }

  /** Gate registration behind F0. Approved → the agent is live immediately (hot) and persisted.
   * Denied / no ask wired → not registered, so no agent is ever created silently. */
  async approveAndRegister(p: AgentProposal): Promise<{ registered: boolean; archetype?: Archetype; reason?: string }> {
    const decision = await this.gate.decide({ id: `agent-${p.name}`, name: "register_agent", arguments: { name: p.name, tools: p.tools, wishlist: p.toolWishlist } });
    if (!decision.allowed) {
      this.opts.runLog?.log("agent_register_denied", `${p.name}: ${decision.reason ?? "denied"}`);
      return { registered: false, reason: decision.reason };
    }
    const archetype: RegisteredAgent = { name: p.name, system: p.system, tools: p.tools, wishlist: p.toolWishlist };
    this.approved.set(p.name, archetype);
    if (this.opts.storePath) this.persist(this.opts.storePath);
    this.opts.runLog?.log("agent_registered", p.name);
    return { registered: true, archetype };
  }

  /** Live approved agents — a consumer (dispatch/bin) reads this and sees new agents with no restart. */
  agents(): RegisteredAgent[] {
    return [...this.approved.values()];
  }

  get(name: string): RegisteredAgent | undefined {
    return this.approved.get(name);
  }

  /** Revoke an approved agent (gated: change_setting). A stale or over-scoped agent must be removable at
   * runtime — otherwise "no silent agent" erodes as the fleet grows. Denied/no-ask → left in place. */
  async revoke(name: string): Promise<{ removed: boolean; reason?: string }> {
    if (!this.approved.has(name)) return { removed: false, reason: `no agent named "${name}"` };
    const decision = await this.gate.decide({ id: `revoke-${name}`, name: "revoke_agent", arguments: { name } });
    if (!decision.allowed) return { removed: false, reason: decision.reason ?? "denied" };
    this.approved.delete(name);
    if (this.opts.storePath) this.persist(this.opts.storePath);
    this.opts.runLog?.log("agent_revoked", name);
    return { removed: true };
  }

  /** Fulfil a wishlist item: grant a tool to an agent (gated). Honestly bounded by the ⊆-parent invariant
   * — a tool the parent doesn't expose can't be granted (the capability doesn't exist yet; add it to the
   * system first, then grant). Granting clears the item from the agent's wishlist. */
  async grantTool(name: string, tool: string): Promise<{ granted: boolean; reason?: string }> {
    const agent = this.approved.get(name);
    if (!agent) return { granted: false, reason: `no agent named "${name}"` };
    if (agent.tools === "inherit") return { granted: false, reason: `"${name}" already inherits all tools` };
    if (!this.parent.schemas().some((s) => s.name === tool)) return { granted: false, reason: `tool "${tool}" is not available in the system — add it first, then grant (⊆-parent invariant)` };
    if (agent.tools.includes(tool)) return { granted: false, reason: `"${name}" already has "${tool}"` };
    const decision = await this.gate.decide({ id: `grant-${name}-${tool}`, name: "grant_tool", arguments: { name, tool } });
    if (!decision.allowed) return { granted: false, reason: decision.reason ?? "denied" };
    agent.tools = [...agent.tools, tool];
    agent.wishlist = agent.wishlist?.filter((w) => w !== tool);
    if (this.opts.storePath) this.persist(this.opts.storePath);
    this.opts.runLog?.log("agent_granted", `${name} += ${tool}`);
    return { granted: true };
  }

  private persist(path: string): void {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify([...this.approved.values()], null, 2));
    } catch {
      /* best-effort — a persist failure just means the agent isn't durable, not that it's unusable now */
    }
  }

  private load(path: string): void {
    try {
      const arr = JSON.parse(readFileSync(path, "utf8")) as RegisteredAgent[];
      for (const a of arr) if (a?.name) this.approved.set(a.name, { name: a.name, system: a.system, tools: a.tools, wishlist: a.wishlist });
    } catch {
      /* no store yet or unreadable — start empty */
    }
  }
}
