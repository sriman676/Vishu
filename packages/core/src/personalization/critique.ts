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
