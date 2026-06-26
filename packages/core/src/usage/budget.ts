import type { EventBus } from "../transport/events.js";
import { readUsage } from "./log.js";
import { buildReport } from "./report.js";

const WEEK_MS = 7 * 86_400_000;

/** Pure budget decision: is weekly spend over budget *and* not yet alerted for this crossing?
 * Edge-triggered (the `alreadyAlerted` flag) so one crossing → one alert, re-armed when spend drops. */
export function budgetAlert(spendUsd: number, budgetUsd: number, alreadyAlerted: boolean): { overUsd: number; pct: number } | null {
  if (budgetUsd <= 0 || alreadyAlerted || spendUsd < budgetUsd) return null;
  return { overUsd: spendUsd - budgetUsd, pct: (spendUsd / budgetUsd) * 100 };
}

/** Poll the usage ledger and publish a `system/notification` the first time 7-day spend exceeds the
 * budget. Rides the existing notification seam (stderr today, OS toast / email in the Phase-14 shell). */
export class BudgetWatcher {
  private alerted = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly file: string,
    private readonly budgetUsd: number,
    private readonly bus: EventBus,
    private readonly everyMs = 3_600_000, // hourly — spend changes slowly, no need to poll hot
  ) {}

  /** One check; exposed for deterministic tests. */
  check(now = Date.now()): void {
    const report = buildReport(readUsage(this.file), WEEK_MS, now);
    const alert = budgetAlert(report.totalUsd, this.budgetUsd, this.alerted);
    if (alert) {
      this.alerted = true;
      this.bus.publish({
        domain: "system",
        type: "notification",
        payload: {
          kind: "budget",
          spendUsd: Number(report.totalUsd.toFixed(2)),
          budgetUsd: this.budgetUsd,
          overUsd: Number(alert.overUsd.toFixed(2)),
          message: `Weekly spend $${report.totalUsd.toFixed(2)} exceeded budget $${this.budgetUsd.toFixed(2)}`,
        },
      });
    } else if (report.totalUsd < this.budgetUsd) {
      this.alerted = false; // window rolled / spend fell back under → re-arm
    }
  }

  start(): void {
    if (this.budgetUsd > 0) this.timer ??= setInterval(() => this.check(), this.everyMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
