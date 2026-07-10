import { isAbsolute, relative, resolve } from "node:path";
import { classifyCommand, type CommandClass } from "./classify.js";
import { guardInjection, type InjectionVerdict } from "./injection.js";

export type Tier = "readonly" | "supervised" | "full";

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

export interface SecurityPolicy {
  tier: Tier;
  /** The only directory the agent may write to / operate in (the path jail root). */
  actionDir: string;
}

export function makePolicy(tier: Tier, actionDir: string): SecurityPolicy {
  return { tier, actionDir: resolve(actionDir) };
}

/** Resolve a path inside the jail; throw if it escapes the action_dir. */
export function jailPath(policy: SecurityPolicy, p: string): string {
  const abs = isAbsolute(p) ? resolve(p) : resolve(policy.actionDir, p);
  const rel = relative(policy.actionDir, abs);
  if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new SecurityError(`path escapes action_dir: ${p}`);
  }
  return abs;
}

/** Writes require a non-readonly tier and an in-jail target. */
export function assertWritable(policy: SecurityPolicy, p: string): string {
  if (policy.tier === "readonly") throw new SecurityError("writes denied in readonly tier");
  return jailPath(policy, p);
}

export interface CommandDecision {
  allowed: boolean;
  klass: CommandClass;
  injection: InjectionVerdict;
  reason?: string;
}

/** Gate a shell command: blocked class or injection==block → denied; risky in supervised is allowed
 * here (the Phase 4 approval layer decides whether to prompt). */
export function decideCommand(policy: SecurityPolicy, command: string): CommandDecision {
  const klass = classifyCommand(command);
  const injection = guardInjection(command);
  if (policy.tier === "readonly") return { allowed: false, klass, injection, reason: "readonly tier" };
  if (klass === "blocked") return { allowed: false, klass, injection, reason: "blocked command" };
  if (injection === "block") return { allowed: false, klass, injection, reason: "prompt-injection blocked" };
  return { allowed: true, klass, injection };
}

// ── Egress allowlist (Phase 1.4 no-exfiltration) ──────────────────────────────
// Hosts Vishu is expected to reach silently: LLM providers + local endpoints.
// A PA MUST make intentional outbound calls (research fetch, apply), so a
// non-allowlisted host is WARNED + logged, not blocked — the enforceable
// guarantee is "nothing goes out unlogged", not "nothing goes out".
const DEFAULT_EGRESS_HOSTS = [
  "localhost", "127.0.0.1",
  "api.anthropic.com", "api.openai.com", "integrate.api.nvidia.com",
  "api.groq.com", "api.mistral.ai", "api.together.xyz", "api.fireworks.ai",
  "api.deepseek.com", "api.perplexity.ai", "api.cohere.ai", "api.x.ai",
  "openrouter.ai", "generativelanguage.googleapis.com",
];

export interface EgressDecision {
  host: string;
  allowlisted: boolean;
  reason?: string;
}

/** The active egress allowlist: defaults ∪ VISHU_EGRESS_ALLOWLIST (comma-separated hosts). */
export function egressAllowlist(): Set<string> {
  const extra = (process.env.VISHU_EGRESS_ALLOWLIST ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set([...DEFAULT_EGRESS_HOSTS, ...extra]);
}

/** Classify an outbound URL against the egress allowlist. Malformed URL → not allowlisted. */
export function decideEgress(url: string, allow: Set<string> = egressAllowlist()): EgressDecision {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { host: "", allowlisted: false, reason: "malformed URL" };
  }
  return { host, allowlisted: allow.has(host) };
}
