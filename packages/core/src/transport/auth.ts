import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let token: string | null = null;

/** Init the per-launch bearer token: VISHU_CORE_TOKEN env wins, else random; persist to core.token. */
export function initToken(workspaceDir: string, env: NodeJS.ProcessEnv = process.env): string {
  token = env.VISHU_CORE_TOKEN || randomBytes(32).toString("hex");
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(join(workspaceDir, "core.token"), token, { mode: 0o600 });
  return token;
}

export function getToken(): string {
  if (!token) throw new Error("[auth] token not initialised");
  return token;
}

/** Constant-time bearer check against the live token. */
export function checkBearer(authHeader: string | undefined): boolean {
  if (!token || !authHeader?.startsWith("Bearer ")) return false;
  const got = Buffer.from(authHeader.slice(7));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}
