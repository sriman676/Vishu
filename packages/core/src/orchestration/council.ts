import type { Router } from "../providers/router.js";

export interface CouncilMember {
  router: Router;
  model: string;
  name?: string;
}

export interface CouncilResult {
  answers: { model: string; text: string }[];
  chosen: string;
  chosenIndex: number;
}

export interface CouncilOptions {
  /** Who picks the winner (default: the first member). */
  judge?: CouncilMember;
  system?: string;
}

/** Multi-model council: ask several models the same prompt, then a judge model picks the best answer.
 * The optional deliberation strategy PLAN Phase 8 left open — use it when single-model branching isn't
 * enough. ponytail: judge-pick, not weighted voting/debate rounds; add those if a single pass underdecides. */
export async function council(members: CouncilMember[], prompt: string, opts: CouncilOptions = {}): Promise<CouncilResult> {
  if (members.length === 0) throw new Error("[council] no members");
  const answers = await Promise.all(
    members.map(async (m) => ({
      model: m.name ?? m.model,
      text: (
        await m.router.chat({
          model: m.model,
          messages: [...(opts.system ? [{ role: "system" as const, content: opts.system }] : []), { role: "user", content: prompt }],
          category: "orchestration",
        })
      ).content,
    })),
  );

  if (answers.length === 1) return { answers, chosen: answers[0]!.text, chosenIndex: 0 };

  const judge = opts.judge ?? members[0]!;
  const ballot = answers.map((a, i) => `[${i}] (${a.model})\n${a.text}`).join("\n\n");
  const pick = await judge.router.chat({
    model: judge.model,
    messages: [
      { role: "system", content: "Pick the single best answer. Reply with only its bracket number." },
      { role: "user", content: `Question:\n${prompt}\n\nCandidates:\n${ballot}` },
    ],
    category: "orchestration",
  });
  const idx = Number(/\d+/.exec(pick.content)?.[0] ?? "0");
  const chosenIndex = Number.isInteger(idx) && idx >= 0 && idx < answers.length ? idx : 0;
  return { answers, chosen: answers[chosenIndex]!.text, chosenIndex };
}

export interface MoaOptions {
  /** Who synthesizes the final answer (default: the first member). */
  aggregator?: CouncilMember;
  /** Proposer rounds; each layer sees the previous layer's proposals (default 2). */
  layers?: number;
  system?: string;
}

export interface MoaResult {
  final: string;
  /** Each layer's proposals, in member order. */
  layerOutputs: string[][];
}

const ask = (m: CouncilMember, prompt: string, system?: string): Promise<string> =>
  m.router
    .chat({
      model: m.model,
      messages: [...(system ? [{ role: "system" as const, content: system }] : []), { role: "user" as const, content: prompt }],
      category: "orchestration",
    })
    .then((r) => r.content);

const refs = (proposals: string[]): string => proposals.map((p, i) => `[${i}]\n${p}`).join("\n\n");

/** Mixture-of-Agents (Wang et al.): N proposers answer, each later layer sees the prior layer's
 * proposals as references, then an aggregator synthesizes one answer. A true multi-model ensemble when
 * members use different routers; degrades cleanly to a single Router. PLAN "capability amplifier" #2. */
export async function mixtureOfAgents(members: CouncilMember[], prompt: string, opts: MoaOptions = {}): Promise<MoaResult> {
  if (members.length === 0) throw new Error("[moa] no members");
  const layers = Math.max(1, opts.layers ?? 2);
  const layerOutputs: string[][] = [];
  let prior: string[] = [];
  for (let l = 0; l < layers; l++) {
    const layerPrompt =
      prior.length === 0
        ? prompt
        : `Other models proposed answers to the question. Use them as reference, then give your own improved answer.\n\nQuestion:\n${prompt}\n\nReferences:\n${refs(prior)}`;
    prior = await Promise.all(members.map((m) => ask(m, layerPrompt, opts.system)));
    layerOutputs.push(prior);
  }
  const aggregator = opts.aggregator ?? members[0]!;
  const final = await ask(aggregator, `Synthesize the single best answer to the question from these candidate responses.\n\nQuestion:\n${prompt}\n\nCandidates:\n${refs(prior)}`, opts.system);
  return { final, layerOutputs };
}
