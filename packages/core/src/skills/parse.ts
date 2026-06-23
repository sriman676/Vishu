import { readFileSync } from "node:fs";
import { basename } from "node:path";

export type SkillRuntime = "bash" | "python";

export interface Skill {
  name: string;
  description: string;
  cluster: string;
  runtime?: SkillRuntime;
  path: string;
}

/** Parse a `---`-delimited YAML-ish frontmatter block. ponytail: flat key: value only — adopt a
 * YAML parser if skills ever need nested metadata. */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { meta: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of text.slice(3, end).split("\n")) {
    const m = /^([A-Za-z_]\w*):\s*(.*)$/.exec(line.trim());
    if (m?.[1]) meta[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(end + 4).replace(/^\s*\n/, "") };
}

/** Read a SKILL.md descriptor (frontmatter only — body stays on disk until invoked). */
export function parseSkill(path: string): Skill {
  const { meta } = parseFrontmatter(readFileSync(path, "utf8"));
  const runtime = meta.runtime === "bash" || meta.runtime === "python" ? meta.runtime : undefined;
  return {
    name: meta.name || basename(path).replace(/\.md$/i, ""),
    description: meta.description ?? "",
    cluster: meta.cluster || "general",
    runtime,
    path,
  };
}

/** Load the instruction/script body — tier 3, only when a skill is actually invoked. */
export function loadBody(path: string): string {
  return parseFrontmatter(readFileSync(path, "utf8")).body;
}
