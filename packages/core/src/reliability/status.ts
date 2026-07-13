/**
 * PAUL escalation status — a graded verdict that replaces a bare pass/allow boolean.
 *  - done: succeeded / allowed outright.
 *  - concerns: proceeded, but something was flagged (partial credit, auto-allowed under a grant).
 *  - needs_context: cannot proceed without a human / more input (denied at a prompt, ungradeable error).
 *  - blocked: hard-stopped by policy (pause, cap, never-without-asking, a graded failure).
 */
export type EscalationStatus = "done" | "concerns" | "needs_context" | "blocked";

/** Grade → status: error needs a human, a fail is blocked, full marks are done, partial is a concern. */
export function gradeStatus(passed: boolean, score: number, errored: boolean): EscalationStatus {
  if (errored) return "needs_context";
  if (!passed) return "blocked";
  return score >= 1 ? "done" : "concerns";
}
