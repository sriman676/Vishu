import { appendFileSync } from "node:fs";

export interface RunLogEntry {
  ts: string;
  kind: string;
  detail: string;
}

/** Audit trail of everything the agent did this run. Optionally tees to a JSONL file. */
export class RunLog {
  private readonly entries: RunLogEntry[] = [];
  constructor(private readonly file?: string) {}

  log(kind: string, detail: string): void {
    const entry: RunLogEntry = { ts: new Date().toISOString(), kind, detail };
    this.entries.push(entry);
    if (this.file) appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
  }

  all(): readonly RunLogEntry[] {
    return this.entries;
  }
}
