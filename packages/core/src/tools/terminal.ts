import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { type Sandbox, noopSandbox } from "./sandbox.js";

export interface ExecResult {
  stdout: string;
  exitCode: number | null;
}

const SENTINEL = "__VISHU_DONE__";

/**
 * Live terminal bound to a working directory, backed by a persistent shell process so cwd and env
 * changes survive across commands (a real session, not isolated spawns).
 * ponytail: persistence via a long-lived shell + sentinel framing — native-dep-free. Upgrade path:
 * node-pty for a true TTY (interactive REPLs, curses apps, ANSI color) when those are needed.
 * Commands are optionally wrapped by a Sandbox (Docker / OS-jail) for defense-in-depth.
 */
export class Terminal {
  private child?: ChildProcessWithoutNullStreams;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    public readonly cwd: string,
    private readonly sandbox: Sandbox = noopSandbox,
  ) {}

  private spawnShell(): ChildProcessWithoutNullStreams {
    const win = process.platform === "win32";
    // No -Command / -c: the shell reads commands from piped stdin line by line (a persistent REPL).
    const child = win
      ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], { cwd: this.cwd })
      : spawn("bash", [], { cwd: this.cwd });
    child.on("error", () => (this.child = undefined));
    child.on("close", () => (this.child = undefined));
    // A forgotten Terminal must never hold the process open; the shell exits on its own when our
    // stdin pipe closes at process exit. Owners that loop hot should still call close() to free it.
    // (stdio pipes are Sockets at runtime — unref exists — but are typed as Readable/Writable.)
    const unref = (s: unknown) => (s as { unref?: () => void }).unref?.();
    unref(child);
    unref(child.stdin);
    unref(child.stdout);
    unref(child.stderr);
    return child;
  }

  /** Marker that echoes the just-finished command's exit code, framed so we can split it out. */
  private marker(): string {
    return process.platform === "win32"
      ? `Write-Output "${SENTINEL}:$LASTEXITCODE"`
      : `printf '%s:%s\\n' "${SENTINEL}" "$?"`;
  }

  exec(command: string, timeoutMs = 120_000): Promise<ExecResult> {
    // Serialize: one persistent shell, so commands must not interleave on the shared stdin/stdout.
    const run = this.queue.then(() => this.execOne(this.sandbox.wrap(command, this.cwd), timeoutMs));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private execOne(command: string, timeoutMs: number): Promise<ExecResult> {
    this.child ??= this.spawnShell();
    const child = this.child;
    return new Promise<ExecResult>((resolve) => {
      let buf = "";
      let done = false;
      const finish = (exitCode: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        const idx = buf.indexOf(`${SENTINEL}:`);
        const stdout = idx >= 0 ? buf.slice(0, idx) : buf;
        resolve({ stdout: stdout.replace(/\r?\n$/, ""), exitCode });
      };
      const onData = (d: Buffer) => {
        buf += d.toString();
        const m = buf.match(new RegExp(`${SENTINEL}:(-?\\d+)?`));
        if (m) finish(m[1] !== undefined && m[1] !== "" ? Number(m[1]) : 0);
      };
      const timer = setTimeout(() => {
        child.kill(); // a hung command kills the session; next exec respawns a clean shell.
        this.child = undefined;
        finish(null);
      }, timeoutMs);
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.stdin.write(`${command}\n${this.marker()}\n`);
    });
  }

  /** Close the persistent shell (idempotent). */
  close(): void {
    this.child?.stdin.end();
    this.child?.kill();
    this.child = undefined;
  }
}
