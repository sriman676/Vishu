import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DigitalTwin } from "./twin.js";

interface ProfileData {
  notes: string[];
}

/** Cross-session identity profile (Set C #6): a persistent per-user set of prefs/recurring-context notes
 * loaded into the system prompt each session so the agent "knows you". Notes come from explicit calls,
 * the digital twin's recurring tasks, or memory rollups. Atomic JSON store, dep-free.
 * ponytail: a deduped note list — no embeddings/profiling; richer structured prefs are the named upgrade. */
export class IdentityProfile {
  private data: ProfileData = { notes: [] };

  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) this.data = JSON.parse(readFileSync(file, "utf8")) as ProfileData;
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file); // atomic: a crash mid-write never corrupts the store
  }

  notes(): string[] {
    return [...this.data.notes];
  }

  /** Add a profile note (trimmed, deduped). Returns false if empty or already present. */
  note(text: string): boolean {
    const t = text.trim();
    if (!t || this.data.notes.includes(t)) return false;
    this.data.notes.push(t);
    this.persist();
    return true;
  }

  /** Fold the twin's recurring tasks in as context; returns how many new notes were added. */
  absorbTwin(twin: DigitalTwin, threshold = 3): number {
    let added = 0;
    for (const s of twin.suggestions(threshold)) if (this.note(`Often asks: ${s}`)) added += 1;
    return added;
  }

  /** System-prompt block, or "" when empty (a fresh profile adds no noise). */
  render(): string {
    if (!this.data.notes.length) return "";
    return `What you know about this user:\n${this.data.notes.map((n) => `- ${n}`).join("\n")}`;
  }
}
