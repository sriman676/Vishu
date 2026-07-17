import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

/** First link's predecessor — a fixed non-hash so a genesis entry is still chained. */
const GENESIS = "0".repeat(64);

/** sha256 over the exact JSON of the record minus its own `hash` field. */
function chainHash(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Append-only decision log (UPGRADES §2) — the durable "everything is logged" guarantee across runs.
 * One JSON object per line, hash-chained (PAUL tamper-evidence): each line carries `prev` (the prior
 * line's hash) and `hash` = sha256 of itself sans-hash. Deleting or editing any line breaks the chain,
 * caught by {@link verifyAuditFile}. Best-effort: a logging failure must never block or crash a tool call.
 */
export class AuditLog {
  constructor(private readonly file: string = defaultAuditFile()) {}
  record(e: AuditEntry): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      // Re-read the tail on every append rather than caching: multiple AuditLog instances share one file
      // (the gate's log + the builtins' egress log both default here), so a cached lastHash would go stale
      // when the other instance appends and fork the chain. record() is fully synchronous, so the read+append
      // can't interleave with another record() in this single-threaded process — the chain stays intact.
      const prev = readLastHash(this.file);
      const base = { ts: new Date().toISOString(), ...e, prev }; // hashed as-is; `hash` appended after
      const hash = chainHash(JSON.stringify(base));
      appendFileSync(this.file, `${JSON.stringify({ ...base, hash })}\n`);
    } catch {
      /* audit is best-effort — never let a logging failure break the action it records */
    }
  }
}

/** Last line's hash, or GENESIS when the file is absent/empty. */
function readLastHash(file: string): string {
  try {
    const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    if (lines.length === 0) return GENESIS;
    return (JSON.parse(lines[lines.length - 1]!) as { hash?: string }).hash ?? GENESIS;
    // ponytail: full-file read to find the tail; audit logs are small. Reverse-seek from EOF if they grow.
  } catch {
    return GENESIS;
  }
}

export interface AuditVerification {
  ok: boolean;
  entries: number;
  /** 1-based line number where the chain first broke, when `ok` is false. */
  brokenAt?: number;
  reason?: string;
}

/** Walk the log, recompute each hash and its link to the prior line; report the first break. */
export function verifyAuditFile(file: string): AuditVerification {
  let lines: string[];
  try {
    lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return { ok: true, entries: 0 }; // no log yet is a valid (empty) chain
  }
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let obj: Record<string, unknown> & { hash?: string; prev?: string };
    try {
      obj = JSON.parse(lines[i]!);
    } catch {
      return { ok: false, entries: lines.length, brokenAt: i + 1, reason: "not valid JSON" };
    }
    const { hash, ...base } = obj;
    if (base.prev !== prev) return { ok: false, entries: lines.length, brokenAt: i + 1, reason: "broken link" };
    if (chainHash(JSON.stringify(base)) !== hash) {
      return { ok: false, entries: lines.length, brokenAt: i + 1, reason: "content altered" };
    }
    prev = hash as string;
  }
  return { ok: true, entries: lines.length };
}

/** decisions.jsonl under the private workspace; override with VISHU_AUDIT_FILE. */
export function defaultAuditFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VISHU_AUDIT_FILE) return resolve(env.VISHU_AUDIT_FILE);
  const home = env.VISHU_HOME ? resolve(env.VISHU_HOME) : homedir();
  return join(home, ".vishu", "audit", "decisions.jsonl");
}
