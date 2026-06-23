import { readFileSync } from "node:fs";
import { resolvePaths, type VishuPaths } from "./paths.js";

export type ProviderType = "mock" | "openai" | "anthropic" | "ollama";

export interface ProviderConfig {
  type: ProviderType;
  model: string;
  baseUrl: string;
  /** One entry per key — the router rotates through them on transient/quota errors. */
  apiKeys: string[];
}

export interface VishuConfig {
  paths: VishuPaths;
  /** TCP port for the transport server (Phase 1). */
  port: number;
  provider: ProviderConfig;
}

const DEFAULT_MODEL: Record<ProviderType, string> = {
  mock: "mock",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-latest",
  ollama: "llama3.2",
};

const DEFAULT_BASE_URL: Record<ProviderType, string> = {
  mock: "",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  ollama: "http://127.0.0.1:11434",
};

function resolveProvider(env: NodeJS.ProcessEnv, file: { provider?: Partial<ProviderConfig> }): ProviderConfig {
  const type = (env.VISHU_PROVIDER || file.provider?.type || "mock") as ProviderType;
  const keys = env.VISHU_API_KEYS
    ? env.VISHU_API_KEYS.split(",").map((k) => k.trim()).filter(Boolean)
    : env.VISHU_API_KEY
      ? [env.VISHU_API_KEY]
      : file.provider?.apiKeys ?? [];
  return {
    type,
    model: env.VISHU_MODEL || file.provider?.model || DEFAULT_MODEL[type],
    baseUrl: env.VISHU_BASE_URL || file.provider?.baseUrl || DEFAULT_BASE_URL[type],
    apiKeys: keys,
  };
}

/**
 * Load config from (in order, later wins): defaults → config file → VISHU_* env.
 * The file is optional; a missing/invalid file is non-fatal (we fall back to defaults).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): VishuConfig {
  const paths = resolvePaths(env);

  let file: { port?: number; provider?: Partial<ProviderConfig> } = {};
  try {
    file = JSON.parse(readFileSync(paths.configFile, "utf8")) as typeof file;
  } catch {
    // ponytail: missing/unreadable config is expected on first run — defaults cover it.
  }

  const port = env.VISHU_PORT ? Number(env.VISHU_PORT) : file.port ?? 5712;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[config] invalid port: ${port}`);
  }

  return { paths, port, provider: resolveProvider(env, file) };
}
