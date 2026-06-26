import type { Router } from "../providers/router.js";

export type SelectMethod = "vote" | "judge";

export interface BestOfNOptions {
  /** Sample count when `temperatures` is not given (default 5). */
  n?: number;
  /** Explicit per-sample temperatures; length overrides `n` for a controlled diversity sweep. */
  temperatures?: number[];
  /** "vote" = majority over normalized answers (default); "judge" = a model picks the best. */
  select?: SelectMethod;
  /** Model for "judge" select (default: the sampling model). */
  judgeModel?: string;
  system?: string;
  /** Bucketing key for vote mode (default: trim + lowercase + collapse whitespace). */
  normalize?: (s: string) => string;
  category?: string;
}

export interface BestOfNResult {
  candidates: string[];
  chosen: string;
  chosenIndex: number;
  method: SelectMethod;
  /** Size of the winning vote bucket (vote mode only). */
  votes?: number;
}

const defaultNormalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Evenly spread n temperatures across [0.2, 1.0] for a diversity sweep; a single sample → 0.7. */
function spread(n: number): number[] {
  if (n <= 1) return [0.7];
  return Array.from({ length: n }, (_, i) => 0.2 + (0.8 * i) / (n - 1));
}

/** Self-consistency / best-of-N: sample several candidates at spread temperatures, then select one by
 * majority vote (test-time compute's core lever) or a judge model. PLAN "capability amplifier" #1. */
export async function bestOfN(
  router: Router,
  model: string,
  prompt: string,
  opts: BestOfNOptions = {},
): Promise<BestOfNResult> {
  const temps = opts.temperatures ?? spread(opts.n ?? 5);
  const method = opts.select ?? "vote";
  const messages = [
    ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
    { role: "user" as const, content: prompt },
  ];
  const candidates = await Promise.all(
    temps.map(async (t) => (await router.chat({ model, messages, temperature: t, category: opts.category ?? "reasoning" })).content),
  );

  if (candidates.length === 1) {
    return { candidates, chosen: candidates[0]!, chosenIndex: 0, method, votes: method === "vote" ? 1 : undefined };
  }

  if (method === "judge") {
    const idx = await judgeSelect(router, opts.judgeModel ?? model, prompt, candidates, opts.category);
    return { candidates, chosen: candidates[idx]!, chosenIndex: idx, method };
  }

  // Majority vote: group by normalized text; the largest bucket wins, ties go to first-seen
  // (Map preserves insertion order + the strict `>` never replaces an equal-sized leader).
  const buckets = new Map<string, number[]>();
  const norm = opts.normalize ?? defaultNormalize;
  candidates.forEach((c, i) => {
    const key = norm(c);
    const arr = buckets.get(key);
    if (arr) arr.push(i);
    else buckets.set(key, [i]);
  });
  let winner: number[] = [];
  for (const idxs of buckets.values()) if (idxs.length > winner.length) winner = idxs;
  const chosenIndex = winner[0]!;
  return { candidates, chosen: candidates[chosenIndex]!, chosenIndex, method, votes: winner.length };
}

/** Ask a model to pick the best candidate by bracket number; unparsable/out-of-range → 0. */
async function judgeSelect(router: Router, model: string, prompt: string, candidates: string[], category?: string): Promise<number> {
  const ballot = candidates.map((c, i) => `[${i}]\n${c}`).join("\n\n");
  const res = await router.chat({
    model,
    messages: [
      { role: "system", content: "Pick the single best answer. Reply with only its bracket number." },
      { role: "user", content: `Question:\n${prompt}\n\nCandidates:\n${ballot}` },
    ],
    category: category ?? "reasoning",
  });
  const idx = Number(/\d+/.exec(res.content)?.[0] ?? "0");
  return Number.isInteger(idx) && idx >= 0 && idx < candidates.length ? idx : 0;
}
