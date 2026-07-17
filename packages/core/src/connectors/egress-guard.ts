import { AuditLog } from "../security/audit.js";
import { decideEgress, egressAllowlist, SecurityError } from "../security/policy.js";

/**
 * §2c send-class egress guard. Read-class fetches (`web_fetch`) warn-only so research can flow, but a
 * send-class connector POSTing to a host that was never declared is a possible exfiltration channel — so
 * this is the stricter side of the honest boundary: every send-class egress is durably logged, and a
 * non-allowlisted destination is refused fail-closed (`deny`), not just warned.
 *
 * Operator-pinned targets count as declared: `WebhookConnector` self-registers its configured URL host and
 * the vendor channel hosts live in `DEFAULT_EGRESS_HOSTS`, so legitimate configured sends pass (and are
 * logged `allow`). The deny path guards any send-class outbound to a host the operator never declared.
 */
export function guardSendEgress(
  tool: string,
  url: string,
  audit: AuditLog = defaultSendAudit,
  allow: Set<string> = egressAllowlist(),
): string {
  const eg = decideEgress(url, allow);
  if (!eg.allowlisted) {
    audit.record({ kind: "egress", tool, host: eg.host || url, verdict: "deny", reason: eg.reason ?? "not on allowlist (send-class)" });
    throw new SecurityError(`send-class egress to non-allowlisted host "${eg.host || url}" refused (${eg.reason ?? "not on allowlist"})`);
  }
  audit.record({ kind: "egress", tool, host: eg.host, verdict: "allow" });
  return eg.host;
}

/** Process-wide append-only sink so every send-class egress lands in the same audit chain as gate decisions. */
const defaultSendAudit = new AuditLog();
