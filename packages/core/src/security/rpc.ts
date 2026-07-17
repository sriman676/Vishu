import { ok, type Registry } from "../transport/rpc.js";
import { defaultAuditFile, verifyAuditFile } from "./audit.js";

/** `vishu.audit_verify` — recompute the audit hash-chain and report the first tamper, if any. */
export function registerAudit(registry: Registry, file: string = defaultAuditFile()): void {
  registry.register("vishu.audit_verify", () => ok(verifyAuditFile(file)));
}
