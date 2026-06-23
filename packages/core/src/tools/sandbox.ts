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
