import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolRegistry } from "../tools/registry.js";
import type { SkillRun } from "./runtime.js";
import { analyzeRepo, renderAnalysis } from "./repoanalyzer.js";

/** CF3b install paths 2 (npm/pip package) + 3 (GitHub repo). Both fetch into a throwaway scratch dir and
 * vet before anything is trusted; the tools are `change_setting` so the F0 gate asks first. ponytail:
 * runner is injected so tests never hit the network; the real one is spawnSync (args-array, never a shell
 * string, so a package name / URL can't inject a command). Nothing is auto-loaded as a live tool — that's
 * a bigger feature (YAGNI); the win here is the sandboxed, vetted, gated fetch. */

/** Run a command with no shell — mirrors `runtime.ts` exec. Injected in tests. */
export type CmdRunner = (cmd: string, args: string[], cwd: string) => SkillRun;

const realRunner: CmdRunner = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 180_000 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

/** Package names must not start with `-` (flag injection) and stay within a safe charset. */
const SAFE_PKG = /^[A-Za-z0-9@._/-]+(?:==[A-Za-z0-9.]+)?$/;
/** Only https GitHub repo URLs — the analyzer + clone assume that shape. */
const GITHUB_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(?:\.git)?$/i;

function scratch(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Path 2 — install a vetted npm/pip package into a scratch dir, then run its audit. Install failure or a
 * bad name → not installed. Audit output is reported (not a hard block): the human sees it before approving. */
export function acquirePackage(manager: "npm" | "pip", name: string, run: CmdRunner = realRunner, dir = scratch("vishu-pkg-")): { installed: boolean; report: string } {
  const pkg = name.trim();
  if (!SAFE_PKG.test(pkg)) return { installed: false, report: `refused: unsafe package name "${pkg}"` };

  const install = manager === "npm" ? run("npm", ["install", "--prefix", dir, pkg], dir) : run("pip", ["install", "--target", dir, pkg], dir);
  if (install.code !== 0) return { installed: false, report: `install failed:\n${install.out}` };

  const audit = manager === "npm" ? run("npm", ["audit", "--prefix", dir], dir) : run("pip-audit", ["--path", dir], dir);
  return { installed: true, report: `installed ${pkg} into ${dir}\n\naudit:\n${audit.out || "(no audit output)"}` };
}

/** Path 3 — clone a GitHub repo shallowly into scratch, run the CF3c analyzer, and REFUSE if it finds a
 * blocker. A clean/warn-only repo is reported for the human's y/N (the install itself stays gated). */
export function acquireRepo(url: string, run: CmdRunner = realRunner, analyze = analyzeRepo, dir = scratch("vishu-repo-")): { cloned: boolean; blocked: boolean; report: string } {
  const u = url.trim();
  if (!GITHUB_URL.test(u)) return { cloned: false, blocked: true, report: `refused: not an https github.com repo URL: "${u}"` };

  const clone = run("git", ["clone", "--depth", "1", u, dir], dir);
  if (clone.code !== 0) return { cloned: false, blocked: true, report: `clone failed:\n${clone.out}` };

  const res = analyze(dir);
  return { cloned: true, blocked: res.blocked, report: `cloned to ${dir}\n\n${renderAnalysis(dir, res)}` };
}

/** Expose paths 2 + 3 as gated tools (change_setting → the F0 gate asks first). */
export function registerInstallTools(registry: ToolRegistry): void {
  registry.register({
    name: "acquire_package",
    meta: { action: "change_setting" },
    description:
      "Acquire capability path 2: install a vetted npm or pip package into a sandboxed scratch dir and run its audit. Gated (asks first). Reports what it installed + audit findings.",
    parameters: { type: "object", properties: { manager: { type: "string", enum: ["npm", "pip"] }, name: { type: "string" } }, required: ["manager", "name"] },
    run: async (args) => {
      const manager = args.manager === "pip" ? "pip" : "npm";
      const { installed, report } = acquirePackage(manager, String(args.name ?? ""));
      return installed ? report : `Not acquired: ${report}`;
    },
  });

  registry.register({
    name: "acquire_repo",
    meta: { action: "change_setting" },
    description:
      "Acquire capability path 3: shallow-clone a GitHub repo into a scratch dir, run the security analyzer, and refuse on any blocker. Gated (asks first). A repo is inert until it passes AND you approve.",
    parameters: { type: "object", properties: { url: { type: "string", description: "https://github.com/owner/repo" } }, required: ["url"] },
    run: async (args) => {
      const { blocked, report } = acquireRepo(String(args.url ?? ""));
      return blocked ? `Install refused (security block):\n${report}` : report;
    },
  });
}
