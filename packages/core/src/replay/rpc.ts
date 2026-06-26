import { ok, type Registry } from "../transport/rpc.js";
import type { Cassette, ReplayMode } from "./cassette.js";

const MODES: ReplayMode[] = ["off", "record", "replay"];

/** `vishu.replay_status` — read or flip the record/replay mode at runtime (off|record|replay). */
export function registerReplay(registry: Registry, cassette: Cassette): void {
  registry.register("vishu.replay_status", (params) => {
    const mode = (params as { mode?: string } | undefined)?.mode;
    if (mode && MODES.includes(mode as ReplayMode)) cassette.mode = mode as ReplayMode;
    return ok({ mode: cassette.mode });
  });
}
