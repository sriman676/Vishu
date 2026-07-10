import { createInterface } from "node:readline/promises";
import type { ApprovalRequest, AskFn } from "./approvals.js";

/** One approval prompt as text → the human's raw answer. Injected so the gate is testable without a TTY. */
export type Prompt = (question: string) => Promise<string>;

function isYes(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  return a === "y" || a === "yes";
}

function line(req: ApprovalRequest): string {
  return `\n[approve] ${req.tool} · ${req.action} · ${req.summary}\n  allow? [y/N] `;
}

/**
 * Terminal approval channel: prompts y/N per gated action. Serialized so concurrent agent turns
 * don't interleave on one stdin, and fail-closed (deny) when no human is attending the terminal.
 * ponytail: single-slot promise lock — fine for one attended user; a real queue if that ever changes.
 */
export function makeAsk(prompt: Prompt, attended: () => boolean = () => Boolean(process.stdin.isTTY)): AskFn {
  let chain: Promise<unknown> = Promise.resolve();
  return (req) => {
    const ask = async () => (attended() ? isYes(await prompt(line(req))) : false);
    const result = chain.then(ask, ask);
    chain = result.catch(() => {});
    return result;
  };
}

/** Default prompt: one readline round over process stdin/stdout. */
export function terminalPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(question).finally(() => rl.close());
}
