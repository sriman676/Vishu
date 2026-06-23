import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadBody, type Skill } from "./parse.js";

/** Derive Git Bash from every `git` on PATH (handles non-standard installs like D:\Git, and the
 * mingw64\bin\git.exe layout where the root is two levels up, not one). */
function bashFromGit(): string | undefined {
  const where = spawnSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" });
  if (where.status !== 0) return undefined;
  const gitExes = where.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const gitExe of gitExes) {
    // git can sit in <root>/cmd, <root>/bin, or <root>/mingw64/bin — walk up a few levels and probe
    // the two real bash locations under the Git root.
    let dir = dirname(gitExe);
    for (let up = 0; up < 3; up++) {
      for (const rel of [["bin", "bash.exe"], ["usr", "bin", "bash.exe"]]) {
        const bash = join(dir, ...rel);
        if (existsSync(bash)) return bash;
      }
      dir = dirname(dir);
    }
  }
  return undefined;
}

/** Locate Git Bash on Windows (bash everywhere else) so bash skills run cross-platform.
 * Order: explicit VISHU_BASH → common install paths → auto-search from any git on PATH. */
export function findBash(): string | null {
  if (process.platform !== "win32") return "bash";
  const candidates = [
    process.env.VISHU_BASH,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ].filter((c): c is string => typeof c === "string");
  const found = candidates.find((c) => existsSync(c));
  if (found) return found;
  return bashFromGit() ?? null;
}

/** Actionable message when no bash is found — bash skills can't run without it. */
export const INSTALL_BASH_MESSAGE =
  "[skill] Git Bash not found. Install it from https://git-scm.com/download/win, " +
  "or set VISHU_BASH to your bash.exe path (e.g. D:\\Git\\bin\\bash.exe).";

function pythonExe(): string | null {
  for (const exe of ["python", "py", "python3"]) {
    if (spawnSync(exe, ["--version"], { encoding: "utf8" }).status === 0) return exe;
  }
  return null;
}

export interface SkillRun {
  code: number;
  out: string;
}

/** Invoke a skill: bash/python skills execute their body; instruction skills return their body
 * (tier-3 disclosure into the model's context). */
export function runSkill(skill: Skill, cwd: string): SkillRun {
  const body = loadBody(skill.path);

  if (skill.runtime === "bash") {
    const bash = findBash();
    if (!bash) return { code: 1, out: INSTALL_BASH_MESSAGE };
    return exec(bash, ["-c", body], cwd);
  }
  if (skill.runtime === "python") {
    const py = pythonExe();
    if (!py) return { code: 1, out: "[skill] python not found on PATH" };
    return exec(py, ["-c", body], cwd);
  }
  return { code: 0, out: body };
}

function exec(cmd: string, args: string[], cwd: string): SkillRun {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 120_000 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}
