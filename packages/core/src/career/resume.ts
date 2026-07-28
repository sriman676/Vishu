/** Cold-apply pipeline S1: resume assembly. Pure functions — parse GitHub projects out of whatever the
 * (mounted) GitHub MCP returned, and assemble a structured resume markdown from profile + achievements +
 * projects. ponytail: the agent does the MCP fetch; this only parses + assembles, so it's robust and
 * testable without guessing MCP tool names/args. */

export interface Project {
  name: string;
  description?: string;
  url?: string;
  language?: string;
  stars?: number;
}

interface RawRepo {
  name?: unknown;
  full_name?: unknown;
  description?: unknown;
  html_url?: unknown;
  url?: unknown;
  language?: unknown;
  stargazers_count?: unknown;
  stars?: unknown;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Parse a GitHub "list repos" response into Projects. Tolerant of the common shapes: a bare array, a
 * `{items:[...]}` (search API) / `{repositories:[...]}` wrapper, or a JSON string of either. Sorted by
 * stars desc; forks/empty entries dropped. Returns [] for anything unrecognised (never throws). */
export function parseGithubProjects(raw: unknown, limit = 8): Project[] {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  const arr: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown[] })?.items)
      ? (data as { items: unknown[] }).items
      : Array.isArray((data as { repositories?: unknown[] })?.repositories)
        ? (data as { repositories: unknown[] }).repositories
        : [];
  const projects: Project[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const r = item as RawRepo;
    const name = str(r.name) ?? str(r.full_name);
    if (!name) continue;
    projects.push({
      name,
      description: str(r.description),
      url: str(r.html_url) ?? str(r.url),
      language: str(r.language),
      stars: num(r.stargazers_count) ?? num(r.stars),
    });
  }
  return projects.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0)).slice(0, limit);
}

export interface ResumeInput {
  profile?: string;
  achievements?: { text: string; at: string }[];
  projects?: Project[];
}

/** Assemble a structured resume markdown. Deterministic — sections are omitted when empty so a sparse
 * profile still produces clean output. This is the S1 output S2 (gen) and S6 (page) consume. */
export function assembleResumeMarkdown(input: ResumeInput): string {
  const parts: string[] = ["# Resume"];
  if (input.profile?.trim()) parts.push("## Summary", input.profile.trim());
  if (input.projects?.length) {
    parts.push(
      "## Projects",
      input.projects
        .map((p) => {
          const head = p.url ? `[${p.name}](${p.url})` : p.name;
          const meta = [p.language, p.stars ? `★${p.stars}` : undefined].filter(Boolean).join(" · ");
          return `- **${head}**${meta ? ` (${meta})` : ""}${p.description ? ` — ${p.description}` : ""}`;
        })
        .join("\n"),
    );
  }
  if (input.achievements?.length) {
    parts.push(
      "## Achievements",
      input.achievements.map((a) => `- ${a.at.slice(0, 10)} — ${a.text}`).join("\n"),
    );
  }
  return parts.join("\n\n");
}
