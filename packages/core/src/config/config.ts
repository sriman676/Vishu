import { readFileSync } from "node:fs";
import { resolvePaths, type VishuPaths } from "./paths.js";

export type ProviderType = "mock" | "openai" | "anthropic" | "ollama";

export interface ProviderConfig {
  type: ProviderType;
  model: string;
  baseUrl: string;
  /** One entry per key — the router rotates through them on transient/quota errors. */
  apiKeys: string[];
  /** Parallel to apiKeys: a human label per key (failover order = array order). */
  keyLabels: string[];
}

/** A file-config key may be a bare string or `{ key, label }` to name it explicitly. */
type KeyEntry = string | { key: string; label?: string };

/** Default label by failover position: primary, backup1, backup2, … */
function defaultLabel(i: number): string {
  return i === 0 ? "primary" : `backup${i}`;
}

export interface VishuConfig {
  paths: VishuPaths;
  /** TCP port for the transport server (Phase 1). */
  port: number;
  /** The default AI — also the RoleRegistry fallback for any unassigned role. */
  provider: ProviderConfig;
  /** Named AIs (multi-provider): `{ "<name>": ProviderConfig }`. Empty when only one AI is configured. */
  providers: Record<string, ProviderConfig>;
  /** role → named-provider assignment, e.g. `{ "builder": "fast", "judge": "smart" }`. */
  roles: Record<string, string>;
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

function resolveProvider(
  env: NodeJS.ProcessEnv,
  file: { provider?: Partial<ProviderConfig> & { apiKeys?: KeyEntry[] } },
): ProviderConfig {
  const type = (env.VISHU_PROVIDER || file.provider?.type || "mock") as ProviderType;
  // Env keys (CSV or single) win over file keys; env can't carry labels, so they get defaults.
  const entries: KeyEntry[] = env.VISHU_API_KEYS
    ? env.VISHU_API_KEYS.split(",").map((k) => k.trim()).filter(Boolean)
    : env.VISHU_API_KEY
      ? [env.VISHU_API_KEY]
      : file.provider?.apiKeys ?? [];
  const apiKeys: string[] = [];
  const keyLabels: string[] = [];
  entries.forEach((e, i) => {
    const key = typeof e === "string" ? e : e.key;
    apiKeys.push(key);
    keyLabels.push((typeof e === "string" ? undefined : e.label) || defaultLabel(i));
  });
  return {
    type,
    model: env.VISHU_MODEL || file.provider?.model || DEFAULT_MODEL[type],
    baseUrl: env.VISHU_BASE_URL || file.provider?.baseUrl || DEFAULT_BASE_URL[type],
    apiKeys,
    keyLabels,
  };
}

type ProviderObject = Partial<ProviderConfig> & { apiKeys?: KeyEntry[] };

/** A named provider comes from the file only (env can't carry a name), so no env precedence here. */
function providerFromObject(o: ProviderObject): ProviderConfig {
  const type = (o.type || "mock") as ProviderType;
  const entries: KeyEntry[] = o.apiKeys ?? [];
  const apiKeys: string[] = [];
  const keyLabels: string[] = [];
  entries.forEach((e, i) => {
    apiKeys.push(typeof e === "string" ? e : e.key);
    keyLabels.push((typeof e === "string" ? undefined : e.label) || defaultLabel(i));
  });
  return { type, model: o.model || DEFAULT_MODEL[type], baseUrl: o.baseUrl || DEFAULT_BASE_URL[type], apiKeys, keyLabels };
}

/**
 * Load config from (in order, later wins): defaults → config file → VISHU_* env.
 * The file is optional; a missing/invalid file is non-fatal (we fall back to defaults).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): VishuConfig {
  const paths = resolvePaths(env);

  let file: {
    port?: number;
    provider?: ProviderObject;
    providers?: Record<string, ProviderObject>;
    roles?: Record<string, string>;
  } = {};
  try {
    file = JSON.parse(readFileSync(paths.configFile, "utf8")) as typeof file;
  } catch {
    // ponytail: missing/unreadable config is expected on first run — defaults cover it.
  }

  const port = env.VISHU_PORT ? Number(env.VISHU_PORT) : file.port ?? 5712;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[config] invalid port: ${port}`);
  }

  const providers: Record<string, ProviderConfig> = {};
  for (const [name, o] of Object.entries(file.providers ?? {})) providers[name] = providerFromObject(o);

  return { paths, port, provider: resolveProvider(env, file), providers, roles: file.roles ?? {} };
}
