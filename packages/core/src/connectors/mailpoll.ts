import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { processDaily } from "./daily.js";
import { fetchPop3 } from "./gmail.js";
import type { InboundDeps } from "./triage.js";

function loadSeen(file: string): Set<string> {
  try {
    return new Set(readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean));
  } catch {
    return new Set();
  }
}
function saveSeen(file: string, seen: Set<string>): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, [...seen].slice(-500).join("\n")); // keep the tail bounded
  } catch {
    /* best-effort: a persist failure just re-triages a message next restart, never loses one */
  }
}

/** Poll Gmail (POP3) on an interval and run each new message through the daily-driver (triage → matter-match
 * → to-do → filed draft). Seen UIDLs persist so a restart never reprocesses. No-op unless GMAIL_USER +
 * GMAIL_APP_PASSWORD are set. ponytail: setInterval poll, cap 10/poll — swap to IMAP IDLE only if latency
 * matters. Returns a stop fn. */
export function startMailPoll(deps: InboundDeps, opts: { seenFile: string; user?: string; pass?: string; intervalMs?: number }): () => void {
  const user = opts.user ?? process.env.GMAIL_USER;
  const pass = opts.pass ?? process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return () => {};
  const interval = opts.intervalMs ?? (Number(process.env.VISHU_MAIL_POLL_MS) || 120_000);
  const seen = loadSeen(opts.seenFile);
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const mail = await fetchPop3(user, pass, seen, 10);
      for (const m of mail) {
        seen.add(m.uid);
        await processDaily(deps, { channel: "email", from: m.from, text: `${m.subject}\n\n${m.text}`, id: m.uid });
      }
      if (mail.length) saveSeen(opts.seenFile, seen);
    } catch (e) {
      deps.bus.publish({ domain: "system", type: "notification", payload: { kind: "mail_poll_error", error: e instanceof Error ? e.message : String(e) } });
    }
  };
  const timer = setInterval(() => void tick(), interval);
  timer.unref?.();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
