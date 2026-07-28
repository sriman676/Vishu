/** Cold-apply pipeline S4: company/HR contact lookup. Pluggable — the source is chosen from whatever
 * creds exist (Apollo/Hunter key), defaulting to the free web lane; no paid tool is required to boot.
 * Pure helpers here (email-pattern guessing + response parsing); the agent does any live MCP/web fetch. */

export interface Contact {
  name?: string;
  email?: string;
  role?: string;
  source: string;
}

export type OsintSource = "apollo" | "hunter" | "web";

/** Which contact source is available, by precedence: a real provider key beats the free web lane. */
export function contactSource(env: NodeJS.ProcessEnv = process.env): OsintSource {
  if (env.APOLLO_API_KEY) return "apollo";
  if (env.HUNTER_API_KEY) return "hunter";
  return "web";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

/** Guess likely work emails from a full name + company domain, in the common corporate patterns. Ordered
 * most-common-first. Deterministic — used to seed outreach when a lookup returns a name but no email. */
export function guessEmails(fullName: string, domain: string): string[] {
  const d = domain.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const parts = fullName.trim().split(/\s+/).map(slug).filter(Boolean);
  const first = parts[0];
  if (!d || !first) return [];
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const patterns = last
    ? [`${first}.${last}`, `${first}${last}`, `${first[0]}${last}`, `${first}_${last}`, `${first}`, `${last}`]
    : [first];
  return [...new Set(patterns)].map((p) => `${p}@${d}`);
}

interface RawContact {
  name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  value?: unknown;
  title?: unknown;
  position?: unknown;
  role?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Parse an Apollo/Hunter/web contact response into Contacts. Tolerant of the common shapes: a bare array,
 * or a `{people|contacts|emails|data:[...]}` wrapper, or a JSON string. Never throws; unknown → []. */
export function parseContacts(raw: unknown, source: OsintSource = "web"): Contact[] {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  const wrap = data as Record<string, unknown[]> | undefined;
  const arr: unknown[] = Array.isArray(data)
    ? data
    : (["people", "contacts", "emails", "data"].map((k) => wrap?.[k]).find(Array.isArray) as unknown[]) ?? [];
  const out: Contact[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const c = item as RawContact;
    const name = str(c.name) ?? ([str(c.first_name), str(c.last_name)].filter(Boolean).join(" ") || undefined);
    const email = str(c.email) ?? str(c.value);
    const role = str(c.title) ?? str(c.position) ?? str(c.role);
    if (!name && !email) continue;
    out.push({ name, email, role, source });
  }
  return out;
}
