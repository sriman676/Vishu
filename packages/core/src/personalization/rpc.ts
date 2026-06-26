import type { WorkflowStore } from "../automation/workflows.js";
import { err, ok, type Registry } from "../transport/rpc.js";
import type { ProjectEvolver } from "./evolve.js";

/** Expose the self-evolving loop over `vishu.evolve_*` — proposals are suggest-only; accept saves a
 * runnable workflow (never auto-applies), dismiss buries the sig. The cron pass produces them. */
export function registerEvolve(registry: Registry, evolver: ProjectEvolver, workflows: WorkflowStore): void {
  registry.register("vishu.evolve_proposals", (params) => {
    const p = (params ?? {}) as { pending?: boolean };
    return ok(p.pending === false ? evolver.list() : evolver.pending());
  });

  registry.register("vishu.evolve_decide", (params) => {
    const p = (params ?? {}) as { sig?: string; decision?: string };
    if (!p.sig) return err("invalid_params", "sig is required");
    if (p.decision !== "accept" && p.decision !== "dismiss") return err("invalid_params", "decision must be 'accept' or 'dismiss'");
    const result = p.decision === "accept" ? evolver.accept(p.sig, workflows) : evolver.dismiss(p.sig);
    return result ? ok(result) : err("not_found", `unknown proposal: ${p.sig}`);
  });
}
