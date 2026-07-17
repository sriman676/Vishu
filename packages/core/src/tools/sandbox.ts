import { execFileSync } from "node:child_process";

/**
 * Sandbox backends: an extra isolation layer beneath the path jail + SecurityPolicy. A Sandbox wraps
 * a shell command so it runs confined. `noop` = current behaviour (jail only); `docker` = run inside
 * an ephemeral container with the workdir bind-mounted.
 * ponytail: noop + docker only. OS-jail backends (firejail/sandbox-exec/AppContainer) are the upgrade
 * path — same `wrap` seam, add a backend when you must run untrusted code without Docker.
 */
export interface Sandbox {
  readonly name: string;
  /** Return the command to actually execute (possibly the original) for `cwd`. */
  wrap(command: string, cwd: string): string;
}

export const noopSandbox: Sandbox = {
  name: "noop",
  wrap: (command) => command,
};

/** Run the command inside a throwaway container with `cwd` mounted at /work. Requires Docker on PATH. */
export function dockerSandbox(image = "alpine:3", opts: { network?: boolean } = {}): Sandbox {
  return {
    name: `docker:${image}`,
    wrap(command, cwd) {
      const net = opts.network ? "" : "--network none ";
      // -i keeps stdin for the persistent shell; the inner sh -c runs the user command in /work.
      const inner = command.replace(/'/g, `'\\''`);
      return `docker run --rm -i ${net}-v "${cwd}:/work" -w /work ${image} sh -c '${inner}'`;
    },
  };
}

let dockerUp: boolean | undefined;
let loggedFallback = false;

/** True if a Docker daemon actually answers (not just the CLI on PATH). Detected once, then cached. */
export function dockerAvailable(): boolean {
  if (dockerUp !== undefined) return dockerUp;
  try {
    // `info` needs a live daemon — `--version` would pass even when Docker Desktop is stopped.
    const bin = process.platform === "win32" ? "docker.exe" : "docker";
    execFileSync(bin, ["info", "--format", "{{.ServerVersion}}"], { stdio: "ignore", timeout: 5_000 });
    dockerUp = true;
  } catch {
    dockerUp = false;
  }
  return dockerUp;
}

/**
 * Pick the execution sandbox: a disposable Docker container when the daemon is up, else the policy
 * (path-jail) sandbox with a one-time "policy-sandbox" log line. VISHU_SANDBOX forces the choice —
 * "policy" never containerizes, "docker" errors if the daemon is absent. VISHU_SANDBOX_IMAGE overrides
 * the image (default alpine:3).
 */
export function autoSandbox(): Sandbox {
  const forced = process.env.VISHU_SANDBOX;
  if (forced === "policy") return noopSandbox;
  if (dockerAvailable()) return dockerSandbox(process.env.VISHU_SANDBOX_IMAGE || "alpine:3");
  if (forced === "docker") throw new Error("VISHU_SANDBOX=docker but no Docker daemon is available");
  if (!loggedFallback) {
    loggedFallback = true;
    console.error("[vishu] policy-sandbox: Docker not detected; shell/file ops run under the path-jail policy only");
  }
  return noopSandbox;
}
