import type { MemoryStore } from "../memory/store.js";
import type { Router } from "../providers/router.js";
import { err, ok, type Registry } from "../transport/rpc.js";

/** A meeting distilled: the gist, the decisions taken, and owner-tagged action items. */
export interface MeetingSummary {
  summary: string;
  decisions: string[];
  actionItems: string[]; // "owner: task" strings
}

/** Parse the model's summary JSON defensively — an odd reply degrades to a plain-text gist, never throws. */
export function parseSummary(text: string): MeetingSummary {
  try {
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const p = JSON.parse(json) as Partial<MeetingSummary>;
    return {
      summary: typeof p.summary === "string" && p.summary.trim() ? p.summary.trim() : text.trim().slice(0, 300),
      decisions: Array.isArray(p.decisions) ? p.decisions.map(String) : [],
      actionItems: Array.isArray(p.actionItems) ? p.actionItems.map(String) : [],
    };
  } catch {
    return { summary: text.trim().slice(0, 300), decisions: [], actionItems: [] };
  }
}

/** Summarize a meeting transcript through the existing provider router (§12e). Pure — no capture, no
 * network beyond the router — so it works on any transcript regardless of how it was obtained. */
export async function summarizeTranscript(router: Router, model: string, transcript: string): Promise<MeetingSummary> {
  const res = await router.chat({
    model,
    messages: [
      {
        role: "system",
        content:
          'Summarize a meeting transcript. Reply with ONLY JSON: {"summary": string, "decisions": string[], "actionItems": string[]}. ' +
          'Each actionItem is an "owner: task" string. Be concise and faithful to the transcript — invent nothing.',
      },
      { role: "user", content: transcript },
    ],
    category: "meeting",
  });
  return parseSummary(res.content);
}

/** Live-meeting platforms. Live join is OWED — see joinMeeting. */
export type MeetingPlatform = "meet" | "zoom" | "teams";

/** Scaffolded live-join. A real join needs a meeting-bot account / paid API (Recall.ai, Zoom SDK, MS
 * Graph) that isn't wired here, so this returns an explicit "owed" instead of pretending to join.
 * ponytail: the seam is here — drop in a bot backend when creds exist. Until then, produce a transcript
 * (voice_transcribe / whisper.cpp from §12b can turn a recording into one) and call meeting_summarize. */
export function joinMeeting(platform: MeetingPlatform, url: string): { joined: false; owed: string } {
  return {
    joined: false,
    owed: `live ${platform} join is not wired (needs a meeting-bot account/API for ${url}); transcribe a recording via voice_transcribe, then call meeting_summarize`,
  };
}

export interface MeetingDeps {
  router: Router;
  model: string;
  /** When set, each summary is filed to the vault as a meeting note. */
  memory?: MemoryStore;
}

/** RPC surface (§12e): `vishu.meeting_summarize` (transcript → structured summary via the router, filed
 * to the vault when memory is available) and `vishu.meeting_join` (scaffolded — reports the owed live-join). */
export function registerMeeting(registry: Registry, deps: MeetingDeps): void {
  registry.register("vishu.meeting_summarize", async (params) => {
    const p = (params ?? {}) as { transcript?: string; title?: string };
    const transcript = (p.transcript ?? "").trim();
    if (!transcript) return err("invalid_params", "transcript is required");
    const summary = await summarizeTranscript(deps.router, deps.model, transcript);
    if (deps.memory) {
      const lines = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none)");
      await deps.memory.put({
        type: "info",
        subject: `meeting-${p.title ? p.title.replace(/\s+/g, "-").slice(0, 40) : Date.now()}`,
        content: `# Meeting${p.title ? `: ${p.title}` : ""}\n\n${summary.summary}\n\n## Decisions\n${lines(summary.decisions)}\n\n## Action items\n${lines(summary.actionItems)}`,
      });
    }
    return ok(summary);
  });

  registry.register("vishu.meeting_join", (params) => {
    const p = (params ?? {}) as { platform?: MeetingPlatform; url?: string };
    if (!p.platform || !p.url) return err("invalid_params", "platform and url are required");
    return ok(joinMeeting(p.platform, p.url));
  });
}
