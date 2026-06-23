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
