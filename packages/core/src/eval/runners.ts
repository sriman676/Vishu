import { mixtureOfAgents } from "../orchestration/council.js";
import type { Router } from "../providers/router.js";
import { effortRoute } from "../reasoning/effort.js";
import type { Runner } from "./types.js";

/** The three comparable runners — the harness's point: does spending test-time compute measurably raise
 * quality? `baseline` = one call; `effort` = adaptive amplification (items 1-4); `moa` = multi-agent
 * ensemble. All produce an answer string, so they're apples-to-apples on the same suite. A Coordinator /
 * agent-loop runner (different task shape — builds, not answers) is the named seam. */
export function makeRunners(router: Router, model: string): Record<string, Runner> {
  return {
    baseline: (prompt) => router.chat({ model, messages: [{ role: "user", content: prompt }], category: "eval" }).then((r) => r.content),
    effort: (prompt) => effortRoute(router, model, prompt).then((r) => r.answer),
    moa: (prompt) => mixtureOfAgents([{ router, model }], prompt, { category: "eval" }).then((r) => r.final),
  };
}
