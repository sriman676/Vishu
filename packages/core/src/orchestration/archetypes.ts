import type { Tier } from "../security/policy.js";
import { ToolRegistry } from "../tools/registry.js";

/** A subagent archetype: a role prompt + the tools it is allowed to touch (its tool policy).
 * `tools: "inherit"` means "every parent tool"; a name list narrows to that subset. */
export interface Archetype {
  name: string;
  system: string;
  tools: string[] | "inherit";
}

/** PLAN Phase 8's four archetypes. Policies are deliberately narrow (least privilege): planners and
 * critics can't write or shell freely; only the coder builds. None can orchestrate (no recursion). */
export const ARCHETYPES: Record<string, Archetype> = {
  planner: {
    name: "planner",
    system: "You are a planner. Break the task into concrete steps. Do not write code; output a short plan.",
    tools: ["read_file", "list_dir", "web_search", "skill_search", "memory_recall"],
  },
  researcher: {
    name: "researcher",
    system: "You are a researcher. Gather the facts needed for the task and summarize them.",
    tools: ["read_file", "list_dir", "web_fetch", "web_search", "skill_search", "memory_recall"],
  },
  coder: {
    name: "coder",
    system: "You are a coder. Implement the task inside the working directory, then verify it runs.",
    tools: ["read_file", "write_file", "list_dir", "run_shell", "skill_search", "skill_run", "memory_recall"],
  },
  critic: {
    name: "critic",
    system: "You are a critic. Review the work against the task, run tests if present, and report problems.",
    tools: ["read_file", "list_dir", "run_shell", "memory_recall"],
  },
};

/** Synthesize an archetype for a novel task that fits none of the presets. Deterministic (no LLM here —
 * the LLM-drafted variant is the Phase 1 Step 5 agent factory): the role prompt is built from the task,
 * and its tool policy is the parent's tools whose name/description mentions a task keyword. So the set is
 * a subset of parent BY CONSTRUCTION, and `narrowRegistry` enforces that again. Falls back to the parent's
 * read-only core when nothing matches — never an empty toolset, never a tool the parent lacks.
 * ponytail: keyword relevance, not embeddings — upgrade to the factory's cited-skills draft when a novel
 * task needs a real bespoke prompt. */
export function synthesizeArchetype(task: string, parent: ToolRegistry): Archetype {
  const words = new Set(task.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const schemas = parent.schemas();
  const relevant = schemas
    .filter((s) => [...words].some((w) => `${s.name} ${s.description}`.toLowerCase().includes(w)))
    .map((s) => s.name);
  const READONLY_CORE = ["read_file", "list_dir", "memory_recall", "web_search", "skill_search"];
  const tools = relevant.length ? relevant : schemas.map((s) => s.name).filter((n) => READONLY_CORE.includes(n));
  return {
    name: "synth",
    system: `You are a specialist assembled for this task:\n${task}\nUse only the tools provided. Do not orchestrate or spawn other agents.`,
    tools,
  };
}

const TIER_RANK: Record<Tier, number> = { readonly: 0, supervised: 1, full: 2 };

/** Inherit-and-narrow: a subagent's tier can only drop, never rise above the parent's. */
export function narrowTier(parent: Tier, requested: Tier): Tier {
  return TIER_RANK[requested] < TIER_RANK[parent] ? requested : parent;
}

/** Build the subagent's tool set = parent tools ∩ archetype policy. Can only narrow, never widen:
 * a tool the parent doesn't have can never appear, whatever the archetype asks for. */
export function narrowRegistry(parent: ToolRegistry, archetype: Archetype): ToolRegistry {
  const parentNames = new Set(parent.schemas().map((s) => s.name));
  const wanted = archetype.tools === "inherit" ? [...parentNames] : archetype.tools.filter((n) => parentNames.has(n));
  const child = new ToolRegistry();
  for (const name of wanted) child.register(parent.get(name));
  return child;
}
