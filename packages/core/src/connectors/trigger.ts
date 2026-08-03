/** Remote-trigger auth — the trust boundary for running the full agent (every mounted MCP, present
 * and future) from an inbound message. FAIL-CLOSED: the trigger is OFF unless `VISHU_TRIGGER_ALLOW`
 * is set. `*` allows any sender; otherwise the sender must match an allowlist entry exactly
 * (case-insensitive, trimmed). Keep this strict — an open trigger is remote code execution. */
export function triggerAllowed(from: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const allow = (env.VISHU_TRIGGER_ALLOW ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) return false; // unconfigured → refuse
  if (allow.includes("*")) return true;
  return allow.includes(from.trim().toLowerCase());
}
