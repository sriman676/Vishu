import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Tool } from "../tools/types.js";

/**
 * Global pause — the instant kill switch (Phase 1 Step 1). A flag FILE, so it:
 *  - survives process restart (a runaway agent can't forget it's paused),
 *  - is settable out-of-band (delete/create the file by hand in an emergency).
 * While paused, ApprovalGate denies every non-read action and TriggerManager skips firings.
 */
export function pauseFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VISHU_PAUSE_FILE) return resolve(env.VISHU_PAUSE_FILE);
  const home = env.VISHU_HOME ? resolve(env.VISHU_HOME) : homedir();
  return join(home, ".vishu", "PAUSED");
}

export function isPaused(file: string = pauseFile()): boolean {
  return existsSync(file);
}

export function pauseReason(file: string = pauseFile()): string {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

export function pause(reason = "", file: string = pauseFile()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${new Date().toISOString()} ${reason}`.trim());
}

export function resume(file: string = pauseFile()): void {
  try {
    rmSync(file);
  } catch {
    /* already resumed */
  }
}

/** jarvis_pause is NEVER gated — pausing must be instant even mid-runaway (ApprovalGate exempts it). */
const pauseTool: Tool = {
  name: "jarvis_pause",
  description: "Engage the global pause: instantly stop all gated actions and trigger firings until resumed.",
  parameters: { type: "object", properties: { reason: { type: "string" } } },
  meta: { action: "read" }, // treated as a safety read so the gate can never block it
  async run(args) {
    const reason = typeof args.reason === "string" ? args.reason : "";
    pause(reason);
    return `paused${reason ? `: ${reason}` : ""}`;
  },
};

/** jarvis_resume is change_setting → the gate still asks (and pause exempts it so it can run while paused). */
const resumeTool: Tool = {
  name: "jarvis_resume",
  description: "Clear the global pause and resume gated actions and triggers.",
  parameters: { type: "object", properties: {} },
  meta: { action: "change_setting" },
  async run() {
    resume();
    return "resumed";
  },
};

export const pauseTools: Tool[] = [pauseTool, resumeTool];
