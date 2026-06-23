export type GateMode = "always_on" | "paused";

/** Scheduler throttle: the knob that pauses background ticks (e.g. on battery / high CPU). Interactive
 * work never passes through here — only the cron/trigger background path checks it.
 * ponytail: battery/CPU sensing is the upgrade path; it would just flip `mode`. */
export class SchedulerGate {
  constructor(private mode: GateMode = "always_on") {}

  allows(): boolean {
    return this.mode === "always_on";
  }

  set(mode: GateMode): void {
    this.mode = mode;
  }
}
