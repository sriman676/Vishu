import type { ChatMessage } from "../providers/types.js";
import { clipMiddle } from "./summarize.js";

export interface CompactOptions {
  /** Recent turns kept verbatim. */
  keepRecent: number;
  /** Max chars for an older tool result before it's condensed. */
  staleToolMax: number;
}

const DEFAULTS: CompactOptions = { keepRecent: 8, staleToolMax: 500 };

/**
 * Active context curation: keep the system prompt + the most recent turns verbatim; condense
 * older tool results (retrieve-over-dump, counter context rot). Returns a new array.
 */
export function compactTranscript(messages: ChatMessage[], opts: Partial<CompactOptions> = {}): ChatMessage[] {
  const o = { ...DEFAULTS, ...opts };
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const cut = Math.max(0, rest.length - o.keepRecent);

  const older = rest.slice(0, cut).map((m) =>
    m.role === "tool" && m.content.length > o.staleToolMax
      ? { ...m, content: clipMiddle(m.content, o.staleToolMax) }
      : m,
  );
  return [...system, ...older, ...rest.slice(cut)];
}
