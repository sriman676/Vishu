/** Brain⇄builder front-door router. Vishu's "hybrid" = not a 50/50 blend but 100% into the lane the
 * situation calls for: PA/ops work → the `pa-master` mode (brain), engineering work → the `co-founder`
 * mode (builder, already pinned to the biggest model). classifyLane reads a request and picks the lane;
 * routeAndActivate flips the ModeManager into it. ponytail: a keyword scorer, no LLM — cheap, deterministic,
 * and good enough for the switch; wire an LLM tiebreaker only if the heuristic measurably mis-routes. */
import type { ModeManager } from "./modes.js";

export type Lane = "brain" | "builder";

/** Mode each lane switches the agent into (both already exist in MODES). */
export const LANE_MODE: Record<Lane, string> = { brain: "pa-master", builder: "co-founder" };

// Engineering signals → builder. Word-boundary matched so "apply" doesn't trip "app".
const BUILDER_RE =
  /\b(code|coding|program|implement|build|compile|refactor|debug|fix(?:ing)?|bug|function|class|api|endpoint|deploy|ship|commit|pull request|pr|merge|test(?:s|ing)?|lint|typescript|python|rust|repo|app|feature|script|stack ?trace|exception|regression)\b/i;
// PA/ops signals → brain. Emails, calendar, research, people, money, reminders, files.
const BRAIN_RE =
  /\b(email|mail|calendar|schedule|remind|meeting|research|find|summar|read|draft|apply|job|internship|invoice|expense|budget|contact|person|people|outreach|message|whatsapp|note|plan my|book|order)\b/i;

/** Which lane a request belongs to. Ties (both/neither signal) fall back to `brain` — the safe default
 * (PA mode is fully gated; it never auto-builds/ships). */
export function classifyLane(text: string): Lane {
  const t = text ?? "";
  const builder = (t.match(BUILDER_RE)?.length ?? 0) ? 1 : 0;
  const brain = (t.match(BRAIN_RE)?.length ?? 0) ? 1 : 0;
  // Count distinct hits so "refactor the build and fix the bug" outweighs a lone "find".
  const bScore = countHits(t, BUILDER_RE);
  const nScore = countHits(t, BRAIN_RE);
  if (bScore === 0 && nScore === 0) return "brain";
  return bScore > nScore ? "builder" : "brain";
}

function countHits(text: string, re: RegExp): number {
  const g = new RegExp(re.source, "gi");
  return (text.match(g) ?? []).length;
}

export type Execution = "local" | "cloud";

// Cloud signals: hard reasoning / coding / architecture / long-form — a small local model can't match these.
const CLOUD_RE =
  /\b(architect|design|implement|build|refactor|debug|algorithm|optimi[sz]e|prove|reason|complex|multi-?step|write code|program|deploy|benchmark|research report)\b/i;
// Local signals: private + cheap + short — exactly the small model's lane (summarise/classify/extract/redact).
const LOCAL_RE =
  /\b(summari[sz]e|classify|categori[sz]e|extract|redact|translate|label|tag|tl;?dr|personal|private|my (?:email|mail|file|files|note|notes|resume|cv|calendar|message|messages))\b/i;

/** Decide whether a task should run on the LOCAL small model (private/cheap/short) or in the CLOUD
 * (hard reasoning/coding/long). Privacy-first: under JARVIS_PRIVACY_MODE=strict a personal/private signal
 * forces local so personal data stays out of cloud prompts. Otherwise a keyword+length scorer; defaults to
 * cloud when there's no local signal (capability-safe). ponytail: deterministic, no LLM tiebreak. */
export function classifyExecution(task: string, env: NodeJS.ProcessEnv = process.env): Execution {
  const t = task ?? "";
  if (env.JARVIS_PRIVACY_MODE === "strict" && LOCAL_RE.test(t)) return "local";
  const cloud = countHits(t, CLOUD_RE) + (t.length > 400 ? 1 : 0); // long tasks lean cloud
  const local = countHits(t, LOCAL_RE);
  if (cloud > local) return "cloud";
  return local > 0 ? "local" : "cloud"; // no local signal → cloud (safer default capability)
}

/** Classify `text` and switch the ModeManager into that lane's mode. Returns the lane + mode chosen. */
export function routeAndActivate(modes: ModeManager, text: string): { lane: Lane; mode: string; activated: boolean } {
  const lane = classifyLane(text);
  const mode = LANE_MODE[lane];
  const res = modes.activate(mode);
  return { lane, mode, activated: res.activated };
}
