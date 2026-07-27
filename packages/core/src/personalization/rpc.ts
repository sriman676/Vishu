import type { WorkflowStore } from "../automation/workflows.js";
import { err, ok, type Registry } from "../transport/rpc.js";
import type { ProjectEvolver, Proposal } from "./evolve.js";
import type { IdentityProfile } from "./profile.js";
import type { DigitalTwin } from "./twin.js";

/** Expose the self-evolving loop over `vishu.evolve_*` — proposals are suggest-only; accept saves a
 * runnable workflow (never auto-applies), dismiss buries the sig. The cron pass produces them. */
export function registerEvolve(
  registry: Registry,
  evolver: ProjectEvolver,
  workflows: WorkflowStore,
  /** Cross-LLM self-improvement (item 4): a critic model reviews Vishu's own prompts and returns
   * suggest-only opportunities. Manual-trigger only (never on the cron) so it can't silently burn
   * provider tokens. Absent → the vishu.evolve_critique RPC reports it's unconfigured. */
  critic?: () => Promise<Omit<Proposal, "status" | "firstSeen">[]>,
): void {
  registry.register("vishu.evolve_proposals", (params) => {
    const p = (params ?? {}) as { pending?: boolean };
    return ok(p.pending === false ? evolver.list() : evolver.pending());
  });

  // On-demand cross-LLM critique of Vishu's own prompts → recorded through the same suggest-only gate.
  registry.register("vishu.evolve_critique", async () => {
    if (!critic) return err("unavailable", "no critic configured — assign a 'reviewer' role to a second AI");
    return ok(evolver.record(await critic()));
  });

  registry.register("vishu.evolve_decide", (params) => {
    const p = (params ?? {}) as { sig?: string; decision?: string };
    if (!p.sig) return err("invalid_params", "sig is required");
    if (p.decision !== "accept" && p.decision !== "dismiss") return err("invalid_params", "decision must be 'accept' or 'dismiss'");
    const result = p.decision === "accept" ? evolver.accept(p.sig, workflows) : evolver.dismiss(p.sig);
    return result ? ok(result) : err("not_found", `unknown proposal: ${p.sig}`);
  });
}

/** Expose the digital twin over `vishu.twin_*` — repeated prompts (auto-recorded in the agent loop)
 * surface as suggestions; accept saves the chosen one as a runnable workflow. */
export function registerTwin(registry: Registry, twin: DigitalTwin, workflows: WorkflowStore): void {
  registry.register("vishu.twin_suggestions", (params) => {
    const p = (params ?? {}) as { threshold?: number };
    return ok(twin.suggestions(p.threshold));
  });

  registry.register("vishu.twin_accept", (params) => {
    const p = (params ?? {}) as { text?: string };
    if (!p.text) return err("invalid_params", "text is required");
    return ok(twin.accept(p.text, workflows));
  });
}

/** Expose the cross-session identity profile over `vishu.profile_*` — read it, add a note, or fold in
 * the twin's recurring tasks. The rendered profile loads into the agent's system prompt each session. */
export function registerProfile(registry: Registry, profile: IdentityProfile, twin: DigitalTwin): void {
  registry.register("vishu.profile_get", () => ok({ notes: profile.notes(), rendered: profile.render() }));

  registry.register("vishu.profile_note", (params) => {
    const p = (params ?? {}) as { text?: string };
    if (!p.text) return err("invalid_params", "text is required");
    return ok({ added: profile.note(p.text) });
  });

  registry.register("vishu.profile_absorb", (params) => {
    const p = (params ?? {}) as { threshold?: number };
    return ok({ added: profile.absorbTwin(twin, p.threshold) });
  });
}
