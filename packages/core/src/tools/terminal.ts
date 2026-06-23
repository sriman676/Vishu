import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  exitCode: number | null;
}

/**
 * Live terminal bound to a working directory.
 * ponytail: each exec spawns the platform shell with a fixed cwd — covers "run the app, report".
 * Upgrade path: node-pty for a persistent interactive TTY (REPLs, curses apps, color).
 */
export class Terminal {
  constructor(public readonly cwd: string) {}

  exec(command: string, timeoutMs = 120_000): Promise<ExecResult> {
    const win = process.platform === "win32";
    const shell = win ? "powershell.exe" : "bash";
    const args = win ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-c", command];

    return new Promise<ExecResult>((resolve) => {
      const child = spawn(shell, args, { cwd: this.cwd });
      let out = "";
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr.on("data", (d: Buffer) => (out += d.toString()));
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ stdout: `${out}${e.message}`, exitCode: 1 });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout: out, exitCode: code });
      });
    });
  }
}
