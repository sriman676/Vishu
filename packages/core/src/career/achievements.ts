import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/** Cold-apply pipeline S0: a timestamped achievements log the user builds by conversation or typing, read
 * later by resume/cover-letter generation. ponytail: atomic JSON file, same shape as DigitalTwin —
 * achievements are few, no index/db needed. Zero external dependency; the one pipeline brick buildable
 * before any MCP is connected. */

export interface Achievement {
  text: string;
  at: string; // ISO timestamp — captured on add, never edited
  tags: string[];
}

interface Data {
  items: Achievement[];
}

/** Split "#tag"s out of the free text so achievements can be grouped on the resume (e.g. #backend). */
function extractTags(text: string): string[] {
  return [...new Set((text.match(/#([a-z0-9][a-z0-9_-]*)/gi) ?? []).map((t) => t.slice(1).toLowerCase()))];
}

export class AchievementStore {
  private data: Data = { items: [] };

  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) this.data = JSON.parse(readFileSync(file, "utf8")) as Data;
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file); // atomic: a crash mid-write never corrupts the log
  }

  /** Record one achievement, timestamped now. Blank text is ignored; a same-text duplicate is skipped so
   * repeating it in conversation doesn't pile up. Returns the stored entry, or null when nothing was added. */
  add(text: string, at: Date = new Date()): Achievement | null {
    const clean = text.trim();
    if (!clean) return null;
    if (this.data.items.some((a) => a.text === clean)) return null;
    const entry: Achievement = { text: clean, at: at.toISOString(), tags: extractTags(clean) };
    this.data.items.push(entry);
    this.persist();
    return entry;
  }

  /** All achievements, newest first. Optional tag filter (case-insensitive). */
  list(tag?: string): Achievement[] {
    const t = tag?.toLowerCase();
    const items = t ? this.data.items.filter((a) => a.tags.includes(t)) : this.data.items;
    return [...items].sort((a, b) => b.at.localeCompare(a.at));
  }
}
