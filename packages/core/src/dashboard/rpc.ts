import type { VishuPaths } from "../config/paths.js";
import { ok, type Registry } from "../transport/rpc.js";
import { snapshot } from "./dashboard.js";

/** `vishu.dashboard_snapshot` (read) — §9 "visualize": data-map + activity feed. Poll to refresh. */
export function registerDashboard(registry: Registry, paths: VishuPaths): void {
  registry.register("vishu.dashboard_snapshot", (params) => {
    const p = (params ?? {}) as { limit?: number };
    const n = p.limit && p.limit > 0 ? Math.min(p.limit, 200) : 40;
    return ok(snapshot(paths, n));
  });
}
