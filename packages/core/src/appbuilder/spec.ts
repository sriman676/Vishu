import type { MemoryStore } from "../memory/store.js";
import type { Router } from "../providers/router.js";

export interface AppSpec {
  name: string;
  goal: string;
  pages: string[];
  dataModel: string[];
  flows: string[];
  constraints: string[];
}

export interface InterviewTurn {
  q: string;
  a: string;
}

export type InterviewStep = { kind: "questions"; questions: string[] } | { kind: "spec"; spec: AppSpec };

const SYSTEM = `You are a software spec interviewer. Given the goal and the Q&A so far, do exactly one of:
- ask the most important remaining clarifying questions, each on its own line prefixed "Q: ", OR
- if pages, data model, flows, and constraints are unambiguous, output "SPEC:" followed by a JSON object
  {"name","goal","pages":[],"dataModel":[],"flows":[],"constraints":[]}.
Never do both. Keep asking until the app is fully specified.`;

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

/** Fill gaps so downstream code never hits undefined fields. */
export function normalizeSpec(goal: string, raw: Partial<AppSpec>): AppSpec {
  return {
    name: (raw.name && String(raw.name)) || goal.slice(0, 40) || "app",
    goal: raw.goal ? String(raw.goal) : goal,
    pages: arr(raw.pages),
    dataModel: arr(raw.dataModel),
    flows: arr(raw.flows),
    constraints: arr(raw.constraints),
  };
}

/** One interview turn: the model either returns more clarifying questions or a complete spec.
 * Pure and stepwise so the CLI (or a future RPC/frontend) drives the loop with the real user. */
export async function interviewStep(router: Router, model: string, goal: string, turns: InterviewTurn[]): Promise<InterviewStep> {
  const qa = turns.map((t) => `Q: ${t.q}\nA: ${t.a}`).join("\n");
  const res = await router.chat({
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Goal: ${goal}\n\n${qa}`.trim() },
    ],
  });
  const idx = res.content.indexOf("SPEC:");
  if (idx >= 0) {
    try {
      return { kind: "spec", spec: normalizeSpec(goal, JSON.parse(res.content.slice(idx + 5).trim()) as Partial<AppSpec>) };
    } catch {
      // malformed JSON → fall through and treat the reply as questions rather than crash the interview.
    }
  }
  const questions = res.content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("Q:"))
    .map((l) => l.slice(2).trim());
  return { kind: "questions", questions: questions.length ? questions : ["What is the single most important feature?"] };
}

/** Render the spec as a vault-friendly markdown note. */
export function specToMarkdown(spec: AppSpec): string {
  const section = (title: string, items: string[]) => `## ${title}\n${items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none)"}`;
  return [
    `# Spec: ${spec.name}`,
    `\n**Goal:** ${spec.goal}\n`,
    section("Pages", spec.pages),
    section("Data model", spec.dataModel),
    section("Flows", spec.flows),
    section("Constraints", spec.constraints),
  ].join("\n\n");
}

/** Persist the approved spec into the Obsidian vault (source of truth). Subject = name, so re-running
 * the interview for the same app supersedes the prior spec instead of duplicating it. */
export async function persistSpec(memory: MemoryStore, spec: AppSpec): Promise<void> {
  await memory.put({ content: specToMarkdown(spec), type: "spec", subject: `spec:${spec.name}` });
}
