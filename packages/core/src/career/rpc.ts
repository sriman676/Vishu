import { ok, err, type Registry } from "../transport/rpc.js";
import type { AchievementStore } from "./achievements.js";

/** Career RPC surface (S6): backs the resume page — assemble the resume, and add/list achievements.
 * Resume generation/scoring/outreach stay agent tools; the page only needs read + achievement capture. */
export interface CareerRpcDeps {
  achievements: AchievementStore;
  /** Assemble the resume markdown; optional raw GitHub repos JSON (from a GitHub MCP) adds projects. */
  buildResume: (projectsJson?: string) => string;
}

export function registerCareer(registry: Registry, deps: CareerRpcDeps): void {
  registry.register("vishu.career_resume", (params) => {
    const p = (params ?? {}) as { projectsJson?: string };
    return ok({ markdown: deps.buildResume(p.projectsJson) });
  });

  registry.register("vishu.career_achievement_add", (params) => {
    const p = (params ?? {}) as { text?: string };
    if (!p.text) return err("invalid_params", "text is required");
    const saved = deps.achievements.add(p.text);
    return saved ? ok(saved) : err("skipped", "blank or duplicate achievement");
  });

  registry.register("vishu.career_achievements", (params) => {
    const p = (params ?? {}) as { tag?: string };
    return ok({ items: deps.achievements.list(p.tag) });
  });
}
