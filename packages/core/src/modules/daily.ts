import { ok } from "../transport/rpc.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import type { VishuModule } from "./registry.js";

// Identify mounted email/calendar READ tools by name, whichever MCP provides them (Composio
// composio__GMAIL_FETCH_EMAILS, composio__GOOGLECALENDAR_EVENTS_LIST, a native gmail__list, …). Matching
// by pattern keeps the brief resilient to the exact server naming. Read-only intent: the brief only
// reads, never sends, so auto-running these is safe under the F0 gate (send/mutate tools don't match).
const EMAIL_READ = /(gmail|email|mail|inbox).*(fetch|list|search|recent|unread|thread|message)/i;
const CAL_READ = /(calendar|gcal|event).*(list|fetch|find|upcoming|event)/i;

const firstMatch = (tools: ToolRegistry, re: RegExp): string | undefined =>
  tools.schemas().map((s) => s.name).find((n) => re.test(n));

/** Compose the daily brief from the (best-effort) email + calendar tool outputs. Pure + tested; a
 * missing source degrades to a "not connected" hint rather than an error, so the brief always renders. */
export function composeBrief(email: string | null, calendar: string | null): string {
  const emailLine = email?.trim() ? `📧 Email\n${email.trim()}` : "📧 Email — not connected (mount a Gmail MCP; see jarvis.domains.json).";
  const calLine = calendar?.trim() ? `📅 Calendar\n${calendar.trim()}` : "📅 Calendar — not connected (mount a Google Calendar MCP; see jarvis.domains.json).";
  return `Daily brief\n\n${emailLine}\n\n${calLine}`;
}

/** Call the first tool matching `re`, best-effort. Missing → null (a "not connected" line); a tool that
 * throws → an inline note, never a thrown brief. ponytail: passes {} as the tool args — good enough for a
 * v1 brief; per-tool query params (date window, unread-only) are the upgrade once the mounted tool's
 * schema is known. */
async function gather(tools: ToolRegistry, re: RegExp, ctx: ToolContext): Promise<string | null> {
  const name = firstMatch(tools, re);
  if (!name) return null;
  try {
    return await tools.get(name).run({}, ctx);
  } catch (e) {
    return `(${name} failed: ${e instanceof Error ? e.message : String(e)})`;
  }
}

/** §11 daily-driver (flag: `daily`): a one-call morning brief over whatever email + calendar MCP is
 * mounted — Composio's Gmail + Google Calendar toolkits out of the box (connect the Google account in
 * Composio; no OAuth code here). Off by default; enable via VISHU_MODULES=daily. */
export const dailyModule: VishuModule = {
  name: "daily",
  setup({ tools, rpc }) {
    const build = async (ctx: ToolContext) =>
      composeBrief(await gather(tools, EMAIL_READ, ctx), await gather(tools, CAL_READ, ctx));

    tools.register({
      name: "daily_brief",
      description: "Summarize today's email + calendar from the mounted Gmail/Calendar MCP into one brief.",
      parameters: { type: "object", properties: {} },
      run: (_args, ctx) => build(ctx),
    });

    // The mounted email/calendar tools are MCP-backed (their run ignores ToolContext), so a minimal ctx
    // is safe from the RPC path where no running-loop context exists.
    rpc.register("vishu.daily_brief", async () => ok({ brief: await build({} as ToolContext) }));
  },
};
