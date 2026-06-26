import { type CouncilMember, mixtureOfAgents } from "../orchestration/council.js";
import type { Router } from "../providers/router.js";
import { bestOfN } from "./selfconsistency.js";

export type Effort = "trivial" | "medium" | "hard";

/** Markers that a query needs real reasoning (design/analysis/multi-step). Cheap heuristic. */
const HARD = /\b(design|architect|prove|derive|debug|optimi[sz]e|trade-?offs?|compare|analy[sz]e|refactor|plan|strateg|implement|algorithm|why|how (do|does|can|would|should))\b/i;

/** Heuristic difficulty classifier — trivial→single call, medium→self-consistency, hard→MoA.
 * ponytail: keyword/length heuristic; a small-model classifier is the named upgrade. */
export function classifyEffort(prompt: string): Effort {
  const text = prompt.trim();
  const questions = (text.match(/\?/g) ?? []).length;
  if (text.length > 400 || questions >= 3 || HARD.test(text)) return "hard";
  if (text.length <= 80 && questions <= 1) return "trivial";
  return "medium";
}

export interface EffortOptions {
  /** Members for the hard path (MoA); default a single member on the given router. */
  members?: CouncilMember[];
  /** Sample count for the medium path (best-of-N); default 5. */
  n?: number;
  /** Override the classifier (e.g. a small-model judge). */
  classify?: (prompt: string) => Effort;
  system?: string;
}

export interface EffortResult {
  effort: Effort;
  answer: string;
}

/** Difficulty/effort router: classify a query, then spend compute where it pays — a single call for
 * trivial, self-consistency for medium, Mixture-of-Agents for hard. The chosen effort tags the usage
 * `category` (`effort:<level>`) so the token report shows where compute went. PLAN amplifier #4. */
export async function effortRoute(router: Router, model: string, prompt: string, opts: EffortOptions = {}): Promise<EffortResult> {
  const effort = (opts.classify ?? classifyEffort)(prompt);
  const category = `effort:${effort}`;

  if (effort === "trivial") {
    const messages = [...(opts.system ? [{ role: "system" as const, content: opts.system }] : []), { role: "user" as const, content: prompt }];
    const res = await router.chat({ model, messages, category });
    return { effort, answer: res.content };
  }

  if (effort === "medium") {
    const res = await bestOfN(router, model, prompt, { n: opts.n ?? 5, system: opts.system, category });
    return { effort, answer: res.chosen };
  }

  const members = opts.members ?? [{ router, model }];
  const res = await mixtureOfAgents(members, prompt, { system: opts.system, category });
  return { effort, answer: res.final };
}
