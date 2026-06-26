import { clipMiddle } from "./summarize.js";

/** Lines that always survive compression — real failure signal, never stripped. (Note: bare "warn" is
 * deliberately absent so install spam like "npm warn deprecated" can be dropped; real errors say "error".) */
const KEEP = /\b(error|failed|failure|exception|fatal|panic|traceback|denied|refused|cannot|could not)\b/i;

/** Collapse runs of identical lines into "line  (×N)" — repetitive logs (installs, retries, stack frames). */
function countDedupe(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i] && lines[i]!.trim()) j += 1;
    const run = j - i;
    out.push(run > 1 ? `${lines[i]}  (×${run})` : lines[i]!);
    i = j;
  }
  return out;
}

/** Per-command noise filters — drop signal-free lines for known tools; KEEP lines always survive.
 * ponytail: a high-value handful; RTK's 100+ command catalog is the named upgrade (add rules here). */
function commandFilter(command: string, lines: string[]): string[] {
  const cmd = command.trim().toLowerCase();
  const drop = (re: RegExp): string[] => lines.filter((l) => KEEP.test(l) || !re.test(l));

  if (/\b(npm|pnpm|yarn|pip3?)\b/.test(cmd) && /\b(install|add|ci)\b/.test(cmd)) {
    return drop(/^\s*(npm warn|added \d+|removed \d+|changed \d+|up to date|audited \d+|requirement already|collecting |downloading |[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])/i);
  }
  if (/^git status/.test(cmd)) return drop(/^\s*(modified:|new file:|deleted:|renamed:|\t)/i); // keep the summary, drop the file list
  if (/\b(pytest|jest|vitest|go test)\b/.test(cmd) || /node --test/.test(cmd)) return drop(/^\s*(PASS\b|ok\s|✓|✔|\.+\s*$)/); // drop passing noise, keep failures

  return lines;
}

export interface ShellCompression {
  text: string;
  beforeLines: number;
  afterLines: number;
}

/** Compress a shell command's output before it enters the model context — the in-process analog of RTK.
 * Per-command noise filters (success only) + count-dedupe + head/tail elision, always preserving error
 * lines. On a non-zero exit the command filters are skipped so failure context survives. Short output is
 * returned untouched. */
export function compressShellOutput(command: string, output: string, exitCode = 0, max = 4000): ShellCompression {
  const lines = output.split("\n");
  if (output.length <= 800 || lines.length <= 12) return { text: output, beforeLines: lines.length, afterLines: lines.length };
  const filtered = countDedupe(exitCode === 0 ? commandFilter(command, lines) : lines);
  const text = clipMiddle(filtered.join("\n"), max);
  return { text, beforeLines: lines.length, afterLines: text.split("\n").length };
}
