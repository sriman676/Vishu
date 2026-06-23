import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Vishu's two security-relevant roots (see PLAN.md locked decisions):
 *  - actionDir:    where the agent is allowed to create/run projects.
 *  - workspaceDir: per-user private workspace; never agent-writable.
 */
export interface VishuPaths {
  userId: string;
  actionDir: string;
  workspaceDir: string;
  configFile: string;
  skillsDir: string;
  /** Plaintext, Obsidian-editable memory vault (source of truth) — visible next to projects. */
  vaultDir: string;
  /** Derived, rebuildable SQLite recall index — hidden under the private workspace. */
  memoryDbFile: string;
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): VishuPaths {
  const home = env.VISHU_HOME ? resolve(env.VISHU_HOME) : homedir();
  const userId = env.VISHU_USER_ID || "default";

  const actionDir = env.VISHU_ACTION_DIR
    ? resolve(env.VISHU_ACTION_DIR)
    : join(home, "Vishu", "projects");

  const workspaceDir = env.VISHU_WORKSPACE_DIR
    ? resolve(env.VISHU_WORKSPACE_DIR)
    : join(home, ".vishu", "users", userId, "workspace");

  const configFile = env.VISHU_CONFIG
    ? resolve(env.VISHU_CONFIG)
    : join(home, ".vishu", "config.json");

  const skillsDir = env.VISHU_SKILLS_DIR
    ? resolve(env.VISHU_SKILLS_DIR)
    : join(home, ".vishu", "skills");

  const vaultDir = env.VISHU_VAULT_DIR ? resolve(env.VISHU_VAULT_DIR) : join(home, "Vishu", "vault");

  const memoryDbFile = env.VISHU_MEMORY_DB
    ? resolve(env.VISHU_MEMORY_DB)
    : join(home, ".vishu", "users", userId, "memory.db");

  return { userId, actionDir, workspaceDir, configFile, skillsDir, vaultDir, memoryDbFile };
}
