/**
 * Action classes (Phase 1 Step 1) — the coarse "what does this tool DO" axis the
 * approval gate uses. Orthogonal to CommandClass (which grades a shell string):
 * a tool has an ActionClass; a shell command additionally has a CommandClass.
 *
 * The load-bearing guarantee: send/spend/delete/change_setting are ALWAYS
 * confirmed by a human, even under `automatic` autonomy. See ApprovalGate.
 */
export type ActionClass = "read" | "write" | "send" | "spend" | "delete" | "change_setting";

/** Never run these without an explicit, per-call human yes — automatic mode does not exempt them. */
export const NEVER_WITHOUT_ASKING: ReadonlySet<ActionClass> = new Set<ActionClass>([
  "send",
  "spend",
  "delete",
  "change_setting",
]);

// Name-heuristic fallback for tools that don't declare meta.action. Checked most-dangerous first so
// an ambiguous name (e.g. "send_and_log") resolves to the more dangerous class (fail-toward-asking).
const PATTERNS: [ActionClass, RegExp][] = [
  ["spend", /\b(pay|spend|transfer|swap|buy|purchase|withdraw|checkout|invoice|charge|wallet|trade)\b|spend|pay|swap|buy|withdraw|charge|wallet/i],
  ["delete", /\b(delete|destroy|drop|purge|wipe|uninstall)\b|delete|destroy|purge|wipe|uninstall|\brm\b/i],
  ["send", /\b(send|email|mail|post|tweet|publish|message|notify|outreach|sms|dispatch|submit|apply)\b|send|email|mail|post|tweet|publish|notify|outreach|submit/i],
  ["change_setting", /\b(config|setting|register|enable|disable|install|permission|autonomy|rotate|grant|revoke|resume)\b|config|setting|register|enable|disable|install|permission|autonomy|rotate|grant|revoke|setmode|set_/i],
  ["write", /\b(write|edit|save|create|update|append|mkdir|move|rename|patch|commit|build|sync)\b|write|edit|save|create|update|append|mkdir|rename|patch|commit/i],
  ["read", /\b(read|list|get|fetch|search|view|show|cat|scan|query|describe|summar|status|health|recall)\b|read|list|get|fetch|search|view|scan|query|recall|status|health/i],
];

/**
 * Classify a tool by name when it carries no explicit meta.action.
 * Fail-closed on ambiguity (dangerous classes win); unknown → "write" (auto-run under
 * automatic like a plain write, but NOT silently treated as read). Tools that genuinely
 * send/spend/delete/change settings MUST still declare meta.action — this is only a net.
 */
export function classifyTool(name: string): ActionClass {
  for (const [klass, re] of PATTERNS) if (re.test(name)) return klass;
  return "write";
}
