import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ApprovalGate, type AskFn } from "../reliability/approvals.js";
import type { RunLog } from "../reliability/runlog.js";
import type { AuditLog } from "../security/audit.js";
import { ok, type Registry } from "../transport/rpc.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { narrowRegistry } from "./archetypes.js";

/** A Mode/mood: a persona the WHOLE agent switches into. Unlike an Archetype (a subagent role), a Mode
 * reshapes the main agent's surface — its system prompt, the tool subset it may use, the memory folder it
 * recalls from, and (later) the voice it speaks in. `tools: "inherit"` = every tool; a name list narrows. */
export interface Mode {
  name: string;
  system: string;
  /** Tools this mode may use; "inherit" = all. Enforcement on the live loop is a follow-up — for now the
   * system prompt states the subset (text-first). */
  tools: string[] | "inherit";
  /** Memory sub-namespace so a mode recalls its own context (MemoryStore scoping is a follow-up). */
  memoryFolder: string;
  /** Spoken-voice id for voice duplex — unfilled until the voice layer lands (text-first for now). */
  voiceId?: string;
}

/** The four predefined modes (PLAN Phase 4 F12). Tool subsets are lean per persona; pa-master + co-founder
 * inherit everything (they DO the work), teacher/interviewer are read-only conversational personas. */
export const MODES: Record<string, Mode> = {
  "pa-master": {
    name: "pa-master",
    system:
      "You are Vishu in personal-assistant mode: proactive, concise, and organized. Manage tasks, mail, calendar, and research on the user's behalf. Confirm before anything that sends, spends, or deletes.",
    tools: "inherit",
    memoryFolder: "pa",
    voiceId: "Zira", // matched loosely against SpeechSynthesis voice names in the UI; falls back to default
  },
  teacher: {
    name: "teacher",
    system:
      "You are Vishu in teacher mode. Explain clearly, from first principles, checking understanding as you go. Ground answers in the user's own material before the wider web. Do not modify files or run commands — teach, don't do.",
    tools: ["read_file", "list_dir", "web_search", "skill_search", "memory_recall"],
    memoryFolder: "teacher",
    voiceId: "David",
  },
  interviewer: {
    name: "interviewer",
    system:
      "You are Vishu in interviewer mode: a professional mock interviewer. Ask one focused question at a time, listen, then probe or give brief feedback. Stay in role; do not solve the problem for the candidate.",
    tools: ["read_file", "memory_recall", "web_search"],
    memoryFolder: "interview",
    voiceId: "Mark",
  },
  "co-founder": {
    name: "co-founder",
    system:
      "You are Vishu in co-founder mode: an opinionated engineering partner. Push back, weigh trade-offs, then build. Use the full tool surface to plan, code, test, and ship inside the action directory. Gated actions still require approval.",
    tools: "inherit",
    memoryFolder: "cofounder",
    voiceId: "Aria",
  },
};

const DEFAULT_MODE = "pa-master";

/** Tools that survive a mode's tool-narrowing no matter how restrictive it is — otherwise a read-only
 * persona (teacher/interviewer) would trap the agent with no way to switch back out. */
const MODE_CONTROL_TOOLS = ["mode_list", "mode_activate"];

/** Draft a bespoke mode from a described need. Deterministic (no LLM in V1: a template over the need),
 * mirroring `proposeAgent`. Inert until `register` clears the gate. A custom mode inherits all tools (the
 * user approves the persona, not a narrowed toolset) and gets its own memory folder. */
export function proposeMode(name: string, need: string): Mode {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "mode";
  return {
    name: slug,
    system: `You are Vishu in "${slug}" mode, assembled for this need:\n${need}\nStay in this persona until switched. Any side-effecting action must pass the approval gate; do not spawn other agents.`,
    tools: "inherit",
    memoryFolder: slug,
  };
}

/** Runtime persona switcher. Predefined modes live in code; custom (auto-created) modes are gated behind
 * the F0 change_setting gate, then persisted (modes.json) and hot-loaded so they run without a restart —
 * the same gate+store discipline as AgentFactory. Detection of "no mode covers this need" is left to the
 * caller (the propose tool names the need); this class owns approve → persist → hot-load → activate. */
export class ModeManager {
  private readonly modes = new Map<string, Mode>();
  private activeName = DEFAULT_MODE;
  private readonly gate: ApprovalGate;

  constructor(private readonly opts: { ask?: AskFn; audit?: AuditLog; storePath?: string; runLog?: RunLog } = {}) {
    for (const [name, mode] of Object.entries(MODES)) this.modes.set(name, mode);
    // Registering a NEW mode is a change_setting → always asks, is pause-denied, and audited.
    this.gate = new ApprovalGate("automatic", opts.ask ?? (async () => false), { actionOf: () => "change_setting", audit: opts.audit });
    if (opts.storePath) this.load(opts.storePath);
  }

  /** Every mode, predefined + custom. */
  list(): Mode[] {
    return [...this.modes.values()];
  }

  /** The mode the main agent is currently in. */
  active(): Mode {
    return this.modes.get(this.activeName) ?? MODES[DEFAULT_MODE]!;
  }

  /** Narrow a registry to the active mode's tool subset (§8): an "inherit" mode gets everything; a listed
   * mode gets its tools ∪ the mode-control tools (so it can always switch back out). Enforcement, not just
   * a prompt hint — teacher/interviewer physically can't write or shell. */
  narrowFor(registry: ToolRegistry): ToolRegistry {
    const m = this.active();
    if (m.tools === "inherit") return registry;
    const tools = [...new Set([...m.tools, ...MODE_CONTROL_TOOLS])];
    return narrowRegistry(registry, { name: m.name, system: m.system, tools });
  }

  /** Switch persona to an existing mode. Non-destructive + reversible, so not gated — but a mode that
   * doesn't exist can't be activated (propose it first). */
  activate(name: string): { activated: boolean; reason?: string } {
    if (!this.modes.has(name)) return { activated: false, reason: `no mode named "${name}" — mode_propose it first` };
    this.activeName = name;
    this.opts.runLog?.log("mode_activated", name);
    return { activated: true };
  }

  /** Draft a new mode from a described need (inert until registered). */
  propose(name: string, need: string): Mode {
    return proposeMode(name, need);
  }

  /** Gate registration behind F0 (change_setting → always asks). Approved → hot-loaded (live immediately)
   * and persisted; when `activate`, the agent switches into it at once. Denied / no ask wired → not
   * registered, so no persona is ever created silently. A name that collides with an existing mode is
   * refused (revoke/rename, don't silently overwrite). */
  async register(mode: Mode, opts: { activate?: boolean } = {}): Promise<{ registered: boolean; reason?: string }> {
    if (this.modes.has(mode.name)) return { registered: false, reason: `mode "${mode.name}" already exists` };
    const decision = await this.gate.decide({ id: `mode-${mode.name}`, name: "register_mode", arguments: { name: mode.name } });
    if (!decision.allowed) {
      this.opts.runLog?.log("mode_register_denied", `${mode.name}: ${decision.reason ?? "denied"}`);
      return { registered: false, reason: decision.reason };
    }
    this.modes.set(mode.name, mode);
    if (this.opts.storePath) this.persist(this.opts.storePath);
    this.opts.runLog?.log("mode_registered", mode.name);
    if (opts.activate) this.activate(mode.name);
    return { registered: true };
  }

  /** Persist only custom modes — the predefined four live in code and would be redundant (and would go
   * stale if their prompts change). */
  private persist(path: string): void {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const custom = this.list().filter((m) => !(m.name in MODES));
      writeFileSync(path, JSON.stringify(custom, null, 2));
    } catch {
      /* best-effort — a persist failure just means the custom mode isn't durable, not unusable now */
    }
  }

  private load(path: string): void {
    try {
      const arr = JSON.parse(readFileSync(path, "utf8")) as Mode[];
      for (const m of arr) if (m?.name && !(m.name in MODES)) this.modes.set(m.name, m);
    } catch {
      /* no store yet or unreadable — start with just the predefined modes */
    }
  }
}

/** Expose modes as tools so the agent (or user) can list/switch/auto-create personas at runtime.
 * mode_list = read; mode_activate = write (a reversible state change); mode_propose = gated create. */
export function registerModeTools(registry: ToolRegistry, modes: ModeManager): void {
  registry.register({
    name: "mode_list",
    meta: { action: "read" },
    description: "List available personas/modes and which one is active.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const active = modes.active().name;
      return modes
        .list()
        .map((m) => `${m.name === active ? "* " : "- "}${m.name} — ${m.tools === "inherit" ? "all tools" : `${m.tools.length} tool(s)`}, memory:${m.memoryFolder}${m.voiceId ? `, voice:${m.voiceId}` : ""}`)
        .join("\n");
    },
  });

  registry.register({
    name: "mode_activate",
    meta: { action: "write" },
    description: "Switch the agent into an existing persona/mode by name.",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    run: async (args) => {
      const res = modes.activate(String(args.name ?? ""));
      return res.activated ? `Now in "${args.name}" mode.` : `Not activated: ${res.reason ?? "unknown mode"}.`;
    },
  });

  registry.register({
    name: "mode_propose",
    // The ModeManager's change_setting gate is the real approval; the tool itself is a plain write.
    meta: { action: "write" },
    description: "Auto-create a NEW persona/mode for a need no existing mode covers, then (once approved) activate it. Registration is gated.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, need: { type: "string", description: "What this persona is for — drives its system prompt." } },
      required: ["name", "need"],
    },
    run: async (args, _ctx: ToolContext) => {
      const draft = modes.propose(String(args.name ?? ""), String(args.need ?? ""));
      const res = await modes.register(draft, { activate: true });
      return res.registered ? `Created and activated "${draft.name}" mode.` : `Not created: ${res.reason ?? "denied"}.`;
    },
  });
}

/** Expose modes over `vishu.mode_*` so the web UI can render a persona switcher and read each mode's voiceId
 * (§8 voice). mode_list = read; mode_activate = a reversible state change (not gated, mirrors the tool). */
export function registerModeRpc(registry: Registry, modes: ModeManager): void {
  registry.register("vishu.mode_list", () => ok({ modes: modes.list(), active: modes.active().name }));
  registry.register("vishu.mode_activate", (params) => {
    const name = String((params as { name?: string } | undefined)?.name ?? "");
    return ok(modes.activate(name));
  });
}
