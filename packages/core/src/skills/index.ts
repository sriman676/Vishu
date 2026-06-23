import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadBody, parseSkill, type Skill } from "./parse.js";

/** Skill library with 3-tier progressive disclosure:
 *  tier 1 — `clusters()` (names in the prompt)
 *  tier 2 — `search()` (matched one-line descriptors)
 *  tier 3 — `body()` (full skill, on invocation only). */
export class SkillIndex {
  private readonly skills = new Map<string, Skill>();

  /** Incremental: add one SKILL.md without reloading the rest. */
  add(path: string): Skill {
    const skill = parseSkill(path);
    this.skills.set(skill.name, skill);
    return skill;
  }

  loadDir(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /\.md$/i.test(entry.name)) this.add(join(dir, entry.name));
    }
  }

  clusters(): string[] {
    return [...new Set([...this.skills.values()].map((s) => s.cluster))].sort();
  }

  /** Token-overlap match against name + description; empty query lists all (capped). */
  search(query: string, limit = 8): { name: string; description: string }[] {
    const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
    const scored = [...this.skills.values()].map((s) => {
      const hay = `${s.name} ${s.description} ${s.cluster}`.toLowerCase();
      const score = terms.length ? terms.filter((t) => hay.includes(t)).length : 1;
      return { skill: s, score };
    });
    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => ({ name: x.skill.name, description: x.skill.description }));
  }

  get(name: string): Skill {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`unknown skill: ${name}`);
    return skill;
  }

  body(name: string): string {
    return loadBody(this.get(name).path);
  }
}
