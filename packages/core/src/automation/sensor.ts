import { cpus } from "node:os";
import type { GateMode, SchedulerGate } from "./gate.js";

/** Pause background work when the machine is busy, resume when it's idle. The non-trivial bit is the
 * decision; the interval wiring around it is trivial. */
export function evalGate(busyFraction: number, maxCpu: number): GateMode {
  return busyFraction > maxCpu ? "paused" : "always_on";
}

/** A sampler returning CPU busy fraction in [0,1] since the previous call (cross-platform via os.cpus). */
export function makeCpuSampler(): () => number {
  const snap = () => {
    let idle = 0;
    let total = 0;
    for (const c of cpus()) {
      for (const t of Object.values(c.times)) total += t;
      idle += c.times.idle;
    }
    return { idle, total };
  };
  let prev = snap();
  return () => {
    const cur = snap();
    const dTotal = cur.total - prev.total;
    const dIdle = cur.idle - prev.idle;
    prev = cur;
    return dTotal > 0 ? 1 - dIdle / dTotal : 0;
  };
}

export interface ResourceGuardOptions {
  maxCpu?: number; // pause above this busy fraction (default 0.85)
  intervalMs?: number; // sampling cadence (default 5s)
  /** Injectable sampler. ponytail: CPU only — no portable Node battery API; supply a sampler that
   * also factors battery (e.g. shelling to `pmset`/`WMI`) if you need battery-aware throttling. */
  sample?: () => number;
}

/** Periodically flip the SchedulerGate based on load. Returns a stop() that clears the timer. */
export function startResourceGuard(gate: SchedulerGate, opts: ResourceGuardOptions = {}): () => void {
  const sample = opts.sample ?? makeCpuSampler();
  const max = opts.maxCpu ?? 0.85;
  const timer = setInterval(() => gate.set(evalGate(sample(), max)), opts.intervalMs ?? 5000);
  timer.unref?.();
  return () => clearInterval(timer);
}
