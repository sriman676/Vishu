export type CommandClass = "safe" | "risky" | "blocked";

// Catastrophic / irreversible — never auto-run.
const BLOCKED = [
  /\brm\s+-rf\s+[/~]/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot|halt)\b/i,
  /\bformat\b\s+[a-z]:/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // fork bomb
  /Remove-Item\b.*-Recurse.*-Force.*[\\/]\s*$/i,
  />\s*\/dev\/sd[a-z]/i,
];

// Reversible-but-dangerous — allowed by classification, gated by the Phase 4 approval layer.
const RISKY = [
  /\brm\b|\bdel\b|Remove-Item\b/i,
  /\bgit\s+push\b/i,
  /\b(npm|pnpm|yarn)\s+publish\b/i,
  /\b(curl|wget|iwr|Invoke-WebRequest)\b.*\|\s*(ba|z|pw)?sh/i,
  /\bsudo\b/i,
  /\bchmod\b|\bchown\b/i,
  /\bkill(all)?\b|Stop-Process\b/i,
];

export function classifyCommand(command: string): CommandClass {
  if (BLOCKED.some((re) => re.test(command))) return "blocked";
  if (RISKY.some((re) => re.test(command))) return "risky";
  return "safe";
}
