import { accessSync, constants, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pauseFile } from "../automation/pause.js";
import { defaultAuditFile } from "../security/audit.js";
import { egressAllowlist } from "../security/policy.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** A failed critical check aborts boot; a non-critical one only warns. */
  critical: boolean;
}

/** Can we create and write the directory this file lives in? */
function dirWritable(file: string): boolean {
  try {
    const dir = dirname(file);
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Boot-time invariants (UPGRADES §5): the runtime must never come up ungated, unlogged, or unable to
 * pause. Returns the check list; assertBoot() prints it and throws on a critical failure — fail loud.
 */
export function selfCheck(opts: { gateWired: boolean; auditFile?: string; pausePath?: string }): Check[] {
  const auditFile = opts.auditFile ?? defaultAuditFile();
  const pausePath = opts.pausePath ?? pauseFile();
  const allow = egressAllowlist();
  return [
    { name: "gate wired", ok: opts.gateWired, critical: true, detail: opts.gateWired ? "approval gate present" : "NO gate — would run ungated" },
    { name: "audit log writable", ok: dirWritable(auditFile), critical: true, detail: auditFile },
    { name: "pause file writable", ok: dirWritable(pausePath), critical: true, detail: pausePath },
    { name: "egress allowlist loaded", ok: allow.size > 0, critical: false, detail: `${allow.size} host(s)` },
  ];
}

/** Print each check; throw if any CRITICAL one failed (aborts boot rather than run unsafe). */
export function assertBoot(checks: Check[], out: (s: string) => void): void {
  for (const c of checks) out(`[selfcheck] ${c.ok ? "ok  " : "FAIL"} ${c.name} — ${c.detail}\n`);
  const failed = checks.filter((c) => !c.ok && c.critical);
  if (failed.length) throw new Error(`startup self-check failed: ${failed.map((c) => c.name).join(", ")}`);
}
