import type { Router } from "../providers/router.js";

export interface ReflexionOptions {
  /** Max revise rounds before stopping on budget (default 2). */
  maxIterations?: number;
  system?: string;
  category?: string;
}

export interface ReflexionResult {
  answer: string;
  /** Revise rounds actually applied (0 = approved on first critique). */
  iterations: number;
  /** The critique text that triggered each revision, in order. */
  critiques: string[];
}

/** Sentinel the critic returns when the answer needs no change — the loop's deterministic stop signal. */
const NO_CHANGE = /\bNO_CHANGE\b/;

const ask = (router: Router, model: string, system: string, user: string, category: string): Promise<string> =>
  router.chat({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], category }).then((r) => r.content);

/** Reflexion: generate an answer, let the model critique its own work, then revise — bounded by
 * maxIterations and stopped early when the critic approves (NO_CHANGE). The LLM-critique analog of the
 * deterministic `selfVerify` loop, applied to any answer (not just builds). PLAN "capability amplifier" #3. */
export async function reflexion(router: Router, model: string, prompt: string, opts: ReflexionOptions = {}): Promise<ReflexionResult> {
  const max = Math.max(0, opts.maxIterations ?? 2);
  const cat = opts.category ?? "reasoning";
  const sys = opts.system ?? "Answer the question.";
  let answer = await ask(router, model, sys, prompt, cat);
  const critiques: string[] = [];
  for (let i = 0; i < max; i++) {
    const critique = await ask(
      router,
      model,
      "You are a critic. Find concrete flaws, errors, or omissions in the answer to the question. If it is correct and complete, reply with exactly NO_CHANGE and nothing else.",
      `Question:\n${prompt}\n\nAnswer:\n${answer}`,
      cat,
    );
    if (NO_CHANGE.test(critique)) break;
    critiques.push(critique);
    answer = await ask(
      router,
      model,
      "Revise the answer to fix the critique. Reply with only the improved answer.",
      `Question:\n${prompt}\n\nAnswer:\n${answer}\n\nCritique:\n${critique}`,
      cat,
    );
  }
  return { answer, iterations: critiques.length, critiques };
}
