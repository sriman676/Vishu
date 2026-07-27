import type { Router } from "../providers/router.js";
import type { MemoryStore } from "../memory/store.js";
import { handleInbound, type InboundDeps } from "./triage.js";
import type { Connector, InboundMessage, TriageResult } from "./types.js";

/** §11a email/calendar daily-driver. The connector/gate/embeddings spine already exists (registerConnectors
 * does inbound triage + gated outbound send, MemoryStore holds records + does cosine recall, the F0 gate
 * covers send). This file is the wiring: a "Matters" record-type, a cosine matcher against open Matters, a
 * one-pass task-extractor, and a draft-reply that lands in the draft+approve lane. Vendor OAuth is stubbed —
 * StubMailConnector / StubCalendar throw "not configured" until real creds are wired (env slots below). */

const MATTERS = "matters"; // vault folder + record-type for ongoing concerns
const DRAFTS = "drafts"; // vault folder for reply drafts awaiting approval
const ORGS = "orgs"; // vault folder + record-type for organizations (contacts' companies)
const DECISIONS = "decisions"; // vault folder + record-type for decisions (what + why)
const DAYBOOK = "daybook"; // vault folder + record-type for the running daily log

/** Open a Matter: an ongoing concern the PA tracks (a deal, a thread, a project). Superseded by subject. */
export async function openMatter(memory: MemoryStore, subject: string, content: string): Promise<void> {
  await memory.put({ type: "matter", subject, folder: MATTERS, content });
}

/** Upsert an organization record (Alfred parity: person/org/decision/daybook record types). Subject-keyed. */
export async function openOrg(memory: MemoryStore, name: string, content: string): Promise<void> {
  await memory.put({ type: "org", subject: `org-${name}`, folder: ORGS, content: `[[${name}]] — ${content}` });
}

/** Record a decision (what + why), linked so future recall can cite the rationale instead of re-reasoning it. */
export async function recordDecision(memory: MemoryStore, subject: string, content: string): Promise<void> {
  await memory.put({ type: "decision", subject: `decision-${subject}`, folder: DECISIONS, content });
}

/** Append an entry to the daybook — a running daily log. Append-only: each entry is its own note under the
 * daybook folder, so recall over `daybook` reconstructs the day without a read-modify-write. */
export async function appendDaybook(memory: MemoryStore, content: string): Promise<void> {
  const now = new Date();
  await memory.put({ type: "daybook", subject: `daybook-${now.toISOString().slice(0, 10)}-${now.getTime()}`, folder: DAYBOOK, content: `- ${content}` });
}

/** A Matter the inbound message plausibly relates to, ranked by the memory index's hybrid cosine score. */
export interface MatterHit {
  name: string;
  body: string;
  score: number;
}

/** Cosine-match an inbound message against open Matters. Reuses MemoryStore.recall (FTS + lexical + the
 * §11f embedding overlay when a router with an embedder is wired) scoped to the matters folder, keeping
 * only "matter" records above the threshold. ponytail: reuse recall rather than a second vector index;
 * raise `min` if unrelated Matters start surfacing. */
export async function matchMatters(memory: MemoryStore, text: string, min = 0.15): Promise<MatterHit[]> {
  const { notes } = await memory.recall(text, { folder: MATTERS, limit: 5 });
  return notes
    .filter((n) => n.type === "matter" && n.score >= min)
    .map((n) => ({ name: n.name, body: n.body, score: n.score }));
}

export interface ExtractedTask {
  task: string;
  due?: string;
}

/** Parse the extractor's two-line reply; a missing/`none` task means "nothing actionable" (returns null). */
export function parseTask(text: string): ExtractedTask | null {
  const task = /task:\s*(.+)/i.exec(text)?.[1]?.trim();
  if (!task || /^none$/i.test(task)) return null;
  const due = /due:\s*(.+)/i.exec(text)?.[1]?.trim();
  return { task, due: due && !/^none$/i.test(due) ? due : undefined };
}

/** One LLM pass: pull a single actionable task + optional due date out of a message (null when none). */
export async function extractTask(router: Router, model: string, text: string): Promise<ExtractedTask | null> {
  const res = await router.chat({
    model,
    messages: [
      {
        role: "system",
        content:
          "Extract the single actionable task the reader must do from this message. Reply exactly:\n" +
          "TASK: <imperative, or 'none'>\n" +
          "DUE: <ISO date / plain when, or 'none'>",
      },
      { role: "user", content: text },
    ],
    category: "connectors",
  });
  return parseTask(res.content);
}

export interface DailyResult {
  triage: TriageResult;
  matters: MatterHit[];
  task: ExtractedTask | null;
  draft?: string;
}

/** Daily-driver pipeline for one inbound email/message: triage (reuse handleInbound → vault task + notify),
 * match open Matters, extract a to-do, and draft a reply into the draft+approve lane. Nothing is sent — the
 * draft is filed for the human; approval + send go through the gated `connectors_send` path. */
export async function processDaily(deps: InboundDeps, msg: InboundMessage): Promise<DailyResult> {
  const triage = await handleInbound(deps, msg);
  if (triage.tier === "skip") return { triage, matters: [], task: null };

  // Contact graph (Alfred parity): upsert one `person` record per sender, superseded on each new mail so
  // recall/Matters gain a who's-who over time. Subject-keyed → no duplicates.
  await deps.memory.put({ type: "person", subject: `person-${msg.from}`, folder: "people", content: `[[${msg.from}]] — last seen on ${msg.channel}: ${triage.summary}` });

  // Org graph (Alfred parity): upsert one `org` record per sender domain so the who's-who gains company context.
  const domain = msg.from.includes("@") ? msg.from.split("@")[1] : undefined;
  if (domain) await openOrg(deps.memory, domain, `contact [[${msg.from}]] active on ${msg.channel}`);

  const matters = await matchMatters(deps.memory, msg.text);
  const task = await extractTask(deps.router, deps.model, msg.text);
  if (task) {
    await deps.memory.put({
      type: "todo",
      subject: `todo-${msg.id ?? msg.ts ?? Date.now()}`,
      content: `- [ ] ${task.task}${task.due ? ` (due: ${task.due})` : ""} — from [[${msg.from}]]`,
    });
  }

  // Draft a reply only when the message wants one. File it (never send) — approval + gated send follow.
  let draft: string | undefined;
  if (triage.tier === "needs_action" || triage.tier === "urgent") {
    const ctx = matters.length ? `\n\nRelated open matters:\n${matters.map((m) => `- ${m.body}`).join("\n")}` : "";
    const voice = deps.voice ? `\n\nWrite in the user's own voice. ${deps.voice}` : "";
    const res = await deps.router.chat({
      model: deps.model,
      messages: [
        { role: "system", content: `Draft a concise, professional reply to this message. Reply with only the message body.${voice}` },
        { role: "user", content: `From ${msg.from}:\n${msg.text}${ctx}` },
      ],
      category: "connectors",
    });
    draft = res.content.trim();
    // ponytail: the draft+approve queue = a "draft" record + a notification; the human approves, then
    // `connectors_send` (F0-gated send-class) dispatches. A dedicated approval UI is 11g's job, not this.
    await deps.memory.put({
      type: "draft",
      subject: `draft-${msg.id ?? msg.ts ?? Date.now()}`,
      folder: DRAFTS,
      content: `Reply to [[${msg.from}]] on ${msg.channel}:\n\n${draft}`,
    });
    deps.bus.publish({ domain: "system", type: "notification", payload: { channel: msg.channel, from: msg.from, kind: "draft_ready", summary: triage.summary } });
  }

  return { triage, matters, task, draft };
}

/** §11h(iii) proactive daily briefing: digest the day's open signals (to-dos, reply drafts, open Matters,
 * recent inbound) into ONE short spoken/written message. Reuses the memory the daily-driver already files
 * — no new store. Returns "" when there's nothing worth surfacing (so a trigger stays quiet on an empty
 * day). ponytail: recall over the record-types 11a writes, one LLM digest pass; a saved TriggerManager
 * workflow can call this on a schedule (the trigger machinery already exists). */
export async function buildBriefing(memory: MemoryStore, router: Router, model: string): Promise<string> {
  const signals: string[] = [];
  for (const [label, query, folder] of [
    ["To-dos", "todo task due", undefined],
    ["Reply drafts", "reply draft awaiting", DRAFTS],
    ["Open matters", "matter ongoing", MATTERS],
  ] as const) {
    const { notes } = await memory.recall(query, { folder, limit: 5 });
    const rows = notes.filter((n) => n.type === (label === "To-dos" ? "todo" : label === "Reply drafts" ? "draft" : "matter"));
    if (rows.length) signals.push(`${label}:\n${rows.map((n) => `- ${n.body.split("\n")[0]}`).join("\n")}`);
  }
  if (!signals.length) return ""; // quiet day — nothing to surface
  const res = await router.chat({
    model,
    messages: [
      { role: "system", content: "Summarize today's open items into a brief, friendly daily briefing (max 6 lines). Lead with what needs action." },
      { role: "user", content: signals.join("\n\n") },
    ],
    category: "connectors",
  });
  return res.content.trim();
}

/** Stub email connector: same `Connector` seam as WebhookConnector/LocalConnector. Real Gmail/Outlook slot
 * their SDK + OAuth token here. Until then `send` throws so a misconfigured lane surfaces loudly.
 * Env slots (documented in .env.example): VISHU_GMAIL_TOKEN or VISHU_OUTLOOK_TOKEN. */
export class StubMailConnector implements Connector {
  readonly channel = "email";
  constructor(private readonly token = process.env.VISHU_GMAIL_TOKEN ?? process.env.VISHU_OUTLOOK_TOKEN) {}
  async send(_to: string, _text: string): Promise<void> {
    throw new Error("[email] not configured — set VISHU_GMAIL_TOKEN or VISHU_OUTLOOK_TOKEN (OAuth wiring pending)");
  }
  get configured(): boolean {
    return Boolean(this.token);
  }
}

export interface CalendarEvent {
  title: string;
  start: string;
  end?: string;
}

/** Stub calendar: the read/create seam a real Google/Outlook Calendar client slots into. Throws until a
 * token is present. Env slots: VISHU_GCAL_TOKEN or VISHU_OUTLOOK_TOKEN. */
export class StubCalendar {
  constructor(private readonly token = process.env.VISHU_GCAL_TOKEN ?? process.env.VISHU_OUTLOOK_TOKEN) {}
  get configured(): boolean {
    return Boolean(this.token);
  }
  async listEvents(_from: string, _to: string): Promise<CalendarEvent[]> {
    throw new Error("[calendar] not configured — set VISHU_GCAL_TOKEN or VISHU_OUTLOOK_TOKEN (OAuth wiring pending)");
  }
  async createEvent(_ev: CalendarEvent): Promise<void> {
    throw new Error("[calendar] not configured — set VISHU_GCAL_TOKEN or VISHU_OUTLOOK_TOKEN (OAuth wiring pending)");
  }
}
