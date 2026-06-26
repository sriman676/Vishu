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
