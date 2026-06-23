import { registerHealth } from "./health.js";
import { Registry } from "./rpc.js";

/** Build the controller registry with all domains wired in (Phase 1: health only). */
export function buildRegistry(version: string, port: number): Registry {
  const registry = new Registry();
  registerHealth(registry, version, port);
  return registry;
}
