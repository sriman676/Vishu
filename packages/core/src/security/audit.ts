import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface AuditEntry {
  kind: "gate" | "egress";
  tool: string;
  /** Action class, for gate decisions. */
  action?: string;
  /** Outbound host, for egress decisions. */
  host?: string;
  verdict: "allow" | "deny" | "warn";
  reason?: string;
}

/**
 * Append-only decision log (UPGRADES §2) — the durable "everything is logged" guarantee across runs.
 * One JSON object per line. Best-effort: a logging failure must never block or crash a tool call.
 */
export class AuditLog {
  constructor(private readonly file: string = defaultAuditFile()) {}
  record(e: AuditEntry): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify({ ts: new Date().toISOString(), ...e })}\n`);
    } catch {
      /* audit is best-effort — never let a logging failure break the action it records */
    }
  }
}

/** decisions.jsonl under the private workspace; override with VISHU_AUDIT_FILE. */
export function defaultAuditFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VISHU_AUDIT_FILE) return resolve(env.VISHU_AUDIT_FILE);
  const home = env.VISHU_HOME ? resolve(env.VISHU_HOME) : homedir();
  return join(home, ".vishu", "audit", "decisions.jsonl");
}
