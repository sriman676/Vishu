import type { ChatMessage } from "./types.js";

/** Qwen3 emits a <think>…</think> reasoning block by default (slow first token). We disable it. */
export const isQwen3 = (model: string): boolean => /qwen3/i.test(model);

/** Remove any <think>…</think> blocks so downstream never sees the reasoning. */
export const stripThink = (text: string): string => text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^\s*/, "");

/** Append /no_think to the last user turn so Qwen3 skips reasoning generation entirely
 * (real latency win — it doesn't produce the block, not just hides it). */
export function withNoThink(messages: ChatMessage[]): ChatMessage[] {
  const i = messages.map((m) => m.role).lastIndexOf("user");
  const last = messages[i];
  if (!last) return messages;
  const copy = messages.slice();
  copy[i] = { ...last, content: `${last.content}\n/no_think` };
  return copy;
}

/** Stateful stream filter: swallows a leading <think>…</think> block across deltas so onDelta
 * never emits reasoning, then passes everything through. ponytail: only handles a leading block,
 * which is all /no_think produces. */
export function makeThinkFilter(): (delta: string) => string {
  let buf = "";
  let pass = false;
  return (delta) => {
    if (pass) return delta;
    buf += delta;
    const t = buf.replace(/^\s*/, "");
    if (t.startsWith("<think>")) {
      const close = buf.indexOf("</think>");
      if (close < 0) return ""; // still inside the block — hold
      pass = true;
      return buf.slice(close + "</think>".length).replace(/^\s*/, "");
    }
    if ("<think>".startsWith(t)) return ""; // could still become <think> — hold
    pass = true; // definitely no think block
    return buf;
  };
}
