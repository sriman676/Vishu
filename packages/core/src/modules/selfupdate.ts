import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { VishuModule } from "./registry.js";

/** Compare dotted numeric versions: >0 if a>b, <0 if a<b, 0 if equal. ponytail: numeric core only,
 * ignores pre-release tags — fine for an "is newer?" check; use a semver lib if ranges matter. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function currentVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

/** Self-update check (dependency-free): report the installed version and whether a candidate is newer.
 * ponytail: caller supplies `latest` (or `VISHU_UPDATE_LATEST`) — no package-registry fetch wired yet. */
export const selfUpdateModule: VishuModule = {
  name: "self-update",
  setup({ tools }) {
    tools.register({
      name: "self_update_check",
      description: "Report the installed version and whether a newer one is available.",
      parameters: { type: "object", properties: { latest: { type: "string" } } },
      run: async (args) => {
        const current = currentVersion();
        const latest = String(args.latest ?? process.env.VISHU_UPDATE_LATEST ?? current);
        return JSON.stringify({ current, latest, updateAvailable: cmpVersion(latest, current) > 0 });
      },
    });
  },
};
