import type { MemoryStore } from "./store.js";
import type { Note } from "./vault.js";

/** Automatic memory: after a turn, pull any DURABLE user fact out of the message and file it, the way
 * ChatGPT quietly remembers "my name is …". ponytail: a zero-token regex gate fronts one cheap model
 * call — a turn like "run the tests" never matches a marker, so it costs nothing. The classifier is the
 * noise guard: a false-positive marker just yields NONE and no write. */

/** First-person durable-signal phrases. Deliberately narrow — bare "I am" is excluded so ordinary task
 * talk ("I am running the tests") doesn't trigger a model call. Broaden if facts are being missed. */
const MARKER =
  /\b(my name is|call me|i prefer|i like|i use|i work (?:at|for|as)|i live in|i'm based|i'm from|remember (?:that|this)|from now on|please remember|my (?:email|phone|number|timezone|time zone|birthday|goal|deadline|address))\b/i;

export function hasDurableMarker(text: string): boolean {
  return MARKER.test(text);
}

export interface FactExtract {
  subject: string;
  content: string;
}

const SYSTEM =
  'You extract durable facts about the USER worth remembering across sessions: their name, stable ' +
  'preferences, tools they use, timezone, contact details, recurring goals. Ignore transient task talk, ' +
  "one-off requests, questions, code, and anything about the assistant. Reply with ONE line of JSON " +
  '{"subject":"<short stable key>","fact":"<the durable fact, third person>"} or exactly NONE if there ' +
  "is nothing durable to remember.";

/** Parse the first {...} object out of a model reply; tolerant of surrounding prose/code fences. */
function parseFact(raw: string): FactExtract | null {
  const trimmed = raw.trim();
  if (!trimmed || /^none\b/i.test(trimmed)) return null;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(trimmed.slice(start, end + 1)) as { subject?: unknown; fact?: unknown };
    const subject = String(j.subject ?? "").trim();
    const content = String(j.fact ?? "").trim();
    if (!subject || !content) return null;
    return { subject, content };
  } catch {
    return null;
  }
}

/** Gate on a durable marker, then ask one cheap model call to extract a fact (or NONE). */
export async function extractFact(
  message: string,
  complete: (system: string, user: string) => Promise<string>,
): Promise<FactExtract | null> {
  if (!hasDurableMarker(message)) return null;
  return parseFact(await complete(SYSTEM, message));
}

/** Post-turn hook: extract a durable fact from the user's message and file it under "core". The subject
 * key lets a restated fact supersede the prior one instead of piling up. Returns the note, or null when
 * nothing durable was found. Callers run this fire-and-forget so it never blocks or breaks a turn. */
export async function learnFromTurn(
  memory: MemoryStore,
  complete: (system: string, user: string) => Promise<string>,
  message: string,
): Promise<Note | null> {
  const fact = await extractFact(message, complete);
  if (!fact) return null;
  return memory.put({ content: fact.content, subject: `user:${fact.subject.toLowerCase()}`, type: "fact", folder: "core" });
}
