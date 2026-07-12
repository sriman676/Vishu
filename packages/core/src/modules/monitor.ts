import type { VishuModule } from "./registry.js";

/** F-PA-MONITOR (Trillion 24/7) — domain watchers (flag: `monitor`). Read-class checks over business
 * sources; a saved TriggerManager workflow calls `monitor_status` on a schedule and a change worth
 * surfacing can be spoken via voice_speak (that wiring is the user's trigger to save). Each source is
 * STUBBED behind its own key: inert (reports "not configured") until the key is set — nothing is faked.
 * ponytail: one generic checker over a source table, not five bespoke clients; add a real fetch per source
 * as each key lands. All read-class + egress-allowlisted by host (declare in jarvis.domains.json egress). */

interface Source {
  name: string;
  envKey: string;
  url: string;
  auth: (key: string) => Record<string, string>;
  summarize: (json: unknown) => string;
}

const SOURCES: Source[] = [
  {
    name: "github",
    envKey: "GITHUB_TOKEN",
    url: "https://api.github.com/notifications",
    auth: (k) => ({ authorization: `Bearer ${k}`, "user-agent": "vishu", accept: "application/vnd.github+json" }),
    summarize: (j) => `${Array.isArray(j) ? j.length : 0} unread GitHub notification(s)`,
  },
  {
    name: "stripe",
    envKey: "STRIPE_API_KEY",
    url: "https://api.stripe.com/v1/balance",
    auth: (k) => ({ authorization: `Bearer ${k}` }),
    summarize: (j) => {
      const b = j as { available?: { amount: number; currency: string }[] };
      const a = b.available?.[0];
      return a ? `Stripe balance: ${(a.amount / 100).toFixed(2)} ${a.currency.toUpperCase()}` : "Stripe balance unavailable";
    },
  },
];

/** Check one source: unconfigured → a clear note; configured → fetch + summarize; error → caught string. */
export async function checkSource(s: Source, env = process.env, fetchImpl: typeof fetch = fetch): Promise<string> {
  const key = env[s.envKey];
  if (!key) return `${s.name}: not configured (set ${s.envKey})`;
  try {
    const res = await fetchImpl(s.url, { headers: s.auth(key) });
    if (!res.ok) return `${s.name}: error ${res.status}`;
    return `${s.name}: ${s.summarize(await res.json())}`;
  } catch (e) {
    return `${s.name}: error ${e instanceof Error ? e.message : String(e)}`;
  }
}

export const monitorModule: VishuModule = {
  name: "monitor",
  setup({ tools }) {
    tools.register({
      name: "monitor_status",
      meta: { action: "read" },
      description: "Check business/dev monitors (GitHub, Stripe, …). Unconfigured sources say so; nothing is faked.",
      parameters: { type: "object", properties: {} },
      run: async () => (await Promise.all(SOURCES.map((s) => checkSource(s)))).join("\n"),
    });
  },
};

export const _sources = SOURCES; // exported for the test
