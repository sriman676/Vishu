import { hostname, platform, release } from "node:os";
import { ok, type Registry } from "./rpc.js";

const startedAt = Date.now();

/** Register the `health` domain controllers. Mirrors the `all.rs` registry wiring. */
export function registerHealth(registry: Registry, version: string, port: number): void {
  registry.register("vishu.health_snapshot", () =>
    ok({ status: "ok", version, uptimeMs: Date.now() - startedAt, pid: process.pid, port }),
  );

  registry.register("vishu.system_info", () =>
    ok({
      version,
      node: process.version,
      platform: platform(),
      release: release(),
      hostname: hostname(),
      pid: process.pid,
    }),
  );
}
