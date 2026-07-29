import { MODES } from "../orchestration/modes.js";
import type { Provider } from "../providers/types.js";
import type { Proposal } from "./evolve.js";

/** Anything that can answer a chat — the Router and any Provider both satisfy this (Router has no
 * `name`, so we don't demand the full Provider surface). */
type Chatter = Pick<Provider, "chat">;

const CRITIC_SYSTEM =
  "You are a critic reviewing another AI assistant's OWN mode system-prompt. Name at most ONE concrete, " +
  "high-leverage improvement — a missing guardrail, an ambiguity, or an unclear instruction. Be terse " +
  "(one or two sentences, no preamble). If the prompt is already solid, reply with exactly: ok";

/** Cross-LLM self-improvement (item 4): a critic model reviews Vishu's own mode system-prompts and
 * returns at most one prose suggestion per mode, shaped as an evolve opportunity so it rides the
 * existing propose/accept/dismiss gate (suggest-only — nothing is auto-applied). The sig is stable per
 * mode (`critique:mode:<key>`) so re-running refreshes the pending suggestion instead of piling up.
 * ponytail: one round-trip per mode, prose only; generating+applying real diffs is the named upgrade. */
export async function critiquePrompts(provider: Chatter, model: string): Promise<Omit<Proposal, "status" | "firstSeen">[]> {
  const out: Omit<Proposal, "status" | "firstSeen">[] = [];
  for (const [key, mode] of Object.entries(MODES)) {
    const res = await provider.chat({
      model,
      category: "critique",
      messages: [
        { role: "system", content: CRITIC_SYSTEM },
        { role: "user", content: `Mode "${mode.name}" system prompt:\n\n${mode.system}` },
      ],
    });
    const suggestion = res.content.trim();
    if (suggestion && suggestion.toLowerCase() !== "ok") {
      out.push({ sig: `critique:mode:${key}`, kind: "critique", target: `mode:${key}`, detail: suggestion.slice(0, 500) });
    }
  }
  return out;
}

/** One reviewer in the council: a distinct model reached through its own Router/Provider. */
export interface CouncilMember {
  model: string;
  provider: Chatter;
}

/** Council v2 of the cross-LLM self-critique moat: run the same per-mode critique across N distinct
 * models and surface ONLY consensus findings — a mode yields a proposal when a MAJORITY of members
 * flag it (every "ok", and every member that errors, casts a no-vote). Result is ranked by consensus
 * strength and the detail carries a `[consensus k/N]` score so the user sees agreement at a glance.
 * Proposals keep the same `critique:mode:<key>` sig, so they ride the existing suggest-only
 * propose/accept/dismiss gate and dedupe with the single-model path. This is the genuinely
 * novel-in-field capability: no rival critiques its own prompts with *multiple other* models.
 * ponytail: majority vote over prose — NO diff generation and NO auto-apply. The human gate stays the
 * whole point (accept() already emits a runnable workflow); auto-apply would break that invariant. */
export async function critiquePromptsCouncil(council: CouncilMember[]): Promise<Omit<Proposal, "status" | "firstSeen">[]> {
  if (council.length === 0) return [];
  const majority = Math.floor(council.length / 2) + 1;
  const scored: { p: Omit<Proposal, "status" | "firstSeen">; votes: number }[] = [];
  for (const [key, mode] of Object.entries(MODES)) {
    const replies = await Promise.all(
      council.map((m) =>
        m.provider
          .chat({
            model: m.model,
            category: "critique",
            messages: [
              { role: "system", content: CRITIC_SYSTEM },
              { role: "user", content: `Mode "${mode.name}" system prompt:\n\n${mode.system}` },
            ],
          })
          .then((r) => r.content.trim())
          .catch(() => "ok"), // a member that errors casts a no-vote — it never breaks the council
      ),
    );
    const flags = replies.filter((s) => s && s.toLowerCase() !== "ok");
    if (flags.length >= majority) {
      const detail = `[consensus ${flags.length}/${council.length}] ${flags.map((s) => s.slice(0, 200)).join(" | ")}`;
      scored.push({ p: { sig: `critique:mode:${key}`, kind: "critique", target: `mode:${key}`, detail: detail.slice(0, 500) }, votes: flags.length });
    }
  }
  return scored.sort((a, b) => b.votes - a.votes).map((s) => s.p); // ranked: strongest consensus first
}
