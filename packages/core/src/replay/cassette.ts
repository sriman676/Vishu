import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatRequest, ChatResponse } from "../providers/types.js";

export type ReplayMode = "off" | "record" | "replay";

/** Stable key for a model call — the inputs that determine the response (not the report-only category). */
function keyOf(req: ChatRequest): string {
  const payload = JSON.stringify({ model: req.model, messages: req.messages, temperature: req.temperature, maxTokens: req.maxTokens, tools: req.tools });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Records Router calls (prompt hash → response) to a JSON cassette, or replays them — making a run
 * reproducible and tests hermetic. The Router is the single chokepoint, so this captures every call.
 * Set C item #5.
 */
export class Cassette {
  private readonly entries: Record<string, ChatResponse>;

  constructor(
    private readonly file: string,
    public mode: ReplayMode = "off",
  ) {
    // Load any existing cassette so a mode flipped to "replay" at runtime still finds its recordings.
    this.entries = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, ChatResponse>) : {};
  }

  /** Recorded response for this request, only in replay mode (undefined ⇒ caller hits the real provider). */
  get(req: ChatRequest): ChatResponse | undefined {
    return this.mode === "replay" ? this.entries[keyOf(req)] : undefined;
  }

  /** Persist a response in record mode; no-op otherwise. Writes per-call so a crash mid-run still saves. */
  put(req: ChatRequest, res: ChatResponse): void {
    if (this.mode !== "record") return;
    this.entries[keyOf(req)] = res;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.entries, null, 2));
  }
}
