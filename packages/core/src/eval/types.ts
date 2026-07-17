import type { EscalationStatus } from "../reliability/status.js";

/** One task's grade: passed (binary) + a 0..1 score (room for partial credit) + an optional note.
 * A grader may set `status` explicitly; otherwise the runner derives it (PAUL escalation). */
export interface Grade {
  passed: boolean;
  score: number;
  detail?: string;
  status?: EscalationStatus;
}

/** An eval task: a prompt and a deterministic grader over the produced answer (no LLM judge — gating
 * on a non-deterministic verdict is unsafe; PLAN #9). */
export interface EvalTask {
  id: string;
  prompt: string;
  grade: (output: string) => Grade;
}

/** The thing under evaluation — anything that turns a prompt into an answer (a plain Router call,
 * effortRoute, an ensemble, …). The abstraction is what makes this a multi-runner comparison harness. */
export type Runner = (prompt: string) => Promise<string>;

export interface EvalResult {
  id: string;
  passed: boolean;
  score: number;
  ms: number;
  detail?: string;
  status: EscalationStatus;
}

export interface EvalReport {
  ts: number;
  runner: string;
  passRate: number;
  meanScore: number;
  results: EvalResult[];
}
