import { appendFileSync, readFileSync } from "node:fs";

/** One model call, as written to `workspaceDir/usage.jsonl` (one JSON object per line). */
export interface UsageRecord {
  ts: number;
  model: string;
  category: string;
  promptTokens: number;
  completionTokens: number;
}

/** Append-only token ledger at the Router chokepoint. Best-effort: a write failure must never
 * break the chat call it is measuring. ponytail: plain JSONL, no rotation; rotate if it ever grows big. */
export class UsageLog {
  constructor(private readonly file: string) {}

  record(rec: UsageRecord): void {
    try {
      appendFileSync(this.file, `${JSON.stringify(rec)}\n`);
    } catch {
      // ledger is observability, not correctness — swallow.
    }
  }
}

/** Read the ledger back, skipping any partial/corrupt line. Missing file → empty. */
export function readUsage(file: string): UsageRecord[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: UsageRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as UsageRecord);
    } catch {
      // skip a half-written tail line
    }
  }
  return out;
}
