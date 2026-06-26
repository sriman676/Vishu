import type { Autonomy } from "../reliability/approvals.js";
import { selfVerify, type Validator } from "../reliability/verify.js";

/** Backend error auto-fix loop (requested backlog). Run a validator (build / tests / lint); on failure
 * dispatch a BOUNDED self-verify fix loop — but only at `automatic` autonomy, otherwise park for
 * approval (Phase 4 gate). The deterministic validator exit code is the gate, never an LLM verdict.
 * Reuses Phase 4 `selfVerify` as the engine; the poke source (a Phase 9 file/cron trigger, or a manual
 * call) is injected by the caller. ponytail: autonomy is known up front, so the automatic path runs
 * selfVerify directly (no extra build); only the parked path validates once, to report the failure. */
export interface AutoFixDeps {
  validator: Validator;
  fix: (failureOutput: string) => Promise<void>;
  autonomy: Autonomy;
  maxAttempts?: number;
  /** Called instead of fixing when autonomy isn't `automatic` — surface it for human approval. */
  onParked?: (output: string) => void;
}

export interface AutoFixResult {
  ran: boolean; // did we attempt any fix?
  ok: boolean; // is the validator green now?
  attempts: number;
}

/** One auto-fix pass: validate, and if it fails, fix-and-reverify within budget (when allowed). */
export async function autoFixPass(deps: AutoFixDeps): Promise<AutoFixResult> {
  if (deps.autonomy !== "automatic") {
    // Not allowed to fix unattended — validate once and park the failure for human approval.
    const probe = await deps.validator.run();
    if (!probe.ok) deps.onParked?.(probe.output);
    return { ran: false, ok: probe.ok, attempts: 0 };
  }
  const r = await selfVerify(deps.validator, deps.fix, deps.maxAttempts ?? 3);
  return { ran: r.attempts > 0, ok: r.ok, attempts: r.attempts };
}
