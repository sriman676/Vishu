import { join } from "node:path";
import { readSpans } from "../reliability/trace.js";
import { err, ok, type Registry } from "../transport/rpc.js";
import { readLedger, ledgerReport } from "./ledger.js";
import { readUsage } from "./log.js";
import { buildReport } from "./report.js";

const DAY_MS = 86_400_000;

/** `vishu.token_report` — aggregate the usage ledger for the last `days` (default 7). */
export function registerUsage(registry: Registry, workspaceDir: string): void {
  registry.register("vishu.token_report", (params) => {
    const p = (params ?? {}) as { days?: number };
    const days = p.days && p.days > 0 ? p.days : 7;
    if (!Number.isFinite(days)) return err("invalid_params", "days must be a positive number");
    const records = readUsage(join(workspaceDir, "usage.jsonl"));
    return ok({ days, ...buildReport(records, days * DAY_MS) });
  });

  // `vishu.ledger_report` — unified token+decision ledger with per-turn cost attribution (PAUL).
  registry.register("vishu.ledger_report", (params) => {
    const p = (params ?? {}) as { days?: number };
    const days = p.days && p.days > 0 ? p.days : 7;
    if (!Number.isFinite(days)) return err("invalid_params", "days must be a positive number");
    const events = readLedger(join(workspaceDir, "usage.jsonl"), join(workspaceDir, "decisions.jsonl"));
    const spans = readSpans(join(workspaceDir, "spans.jsonl"));
    return ok({ days, ...ledgerReport(events, days * DAY_MS, Date.now(), spans) });
  });
}
