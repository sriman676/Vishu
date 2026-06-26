import type { EvalTask, Grade } from "./types.js";

const hit = (re: RegExp): ((o: string) => Grade) => (o) => ({ passed: re.test(o), score: re.test(o) ? 1 : 0 });

/** Built-in starter suite: deterministically-graded probes of single- and multi-step quality. Real model
 * capability shows up as pass rate; a weak model scores low (that's the measurement working). Extend by
 * appending tasks, or load a project suite from disk (named seam). */
export const BUILTIN_SUITE: EvalTask[] = [
  { id: "math-add", prompt: "What is 17 + 25? Reply with just the number.", grade: hit(/\b42\b/) },
  { id: "factual", prompt: "What is the chemical formula for water? Reply with just the formula.", grade: hit(/H2O/i) },
  {
    id: "json-format",
    prompt: 'Reply with exactly this and nothing else: {"ok":true}',
    grade: (o) => {
      try {
        const j = JSON.parse(o.trim()) as { ok?: unknown };
        return { passed: j.ok === true, score: j.ok === true ? 1 : 0 };
      } catch {
        return { passed: false, score: 0, detail: "invalid JSON" };
      }
    },
  },
  {
    id: "multistep",
    prompt: "A train travels 240 km in 3 hours. What is its average speed in km/h? Reply with just the number.",
    grade: hit(/\b80\b/),
  },
];
