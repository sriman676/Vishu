import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadNimState } from "../providers/nimrefresh.js";
import { resolvePaths, type VishuPaths } from "./paths.js";

/** Where the weekly best-available NIM chain is persisted (VISHU_NIM_STATE overrides). */
export function nimStateFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.VISHU_NIM_STATE || join(process.cwd(), "nim-models.json");
}

export type ProviderType = "mock" | "openai" | "anthropic" | "ollama";

export interface ProviderConfig {
  type: ProviderType;
  model: string;
  baseUrl: string;
  /** One entry per key — the router rotates through them on transient/quota errors. */
  apiKeys: string[];
  /** Parallel to apiKeys: a human label per key (failover order = array order). */
  keyLabels: string[];
  /** Reroute chain: models to retry (in order) when `model` times out / 5xxs / is gone. Router-level. */
  modelFallbacks?: string[];
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
  /** Weekly spend budget in USD; 0 disables budget alerts. */
  budgetUsd: number;
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

/** Friendly provider presets → which adapter + endpoint + default model. Lets `VISHU_PROVIDER=gemini`
 * (etc.) "just work" through the OpenAI-compatible adapter with no manual base-url/model wiring. */
const PRESETS: Record<string, { type: ProviderType; baseUrl: string; model: string }> = {
  gemini: { type: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" },
  openrouter: { type: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  groq: { type: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  deepseek: { type: "openai", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  nvidia: { type: "openai", baseUrl: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.1-8b-instruct" },
  mistral: { type: "openai", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  together: { type: "openai", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  fireworks: { type: "openai", baseUrl: "https://api.fireworks.ai/inference/v1", model: "accounts/fireworks/models/llama-v3p1-8b-instruct" },
  xai: { type: "openai", baseUrl: "https://api.x.ai/v1", model: "grok-2-latest" },
  perplexity: { type: "openai", baseUrl: "https://api.perplexity.ai", model: "sonar" },
  cohere: { type: "openai", baseUrl: "https://api.cohere.ai/compatibility/v1", model: "command-r" },
  // Local Qwen3 on Intel Arc via IPEX-LLM's Ollama portable (OpenAI-compatible at :11434/v1). Offline,
  // credential-free — any VISHU_API_KEY value works (Ollama ignores it). See scripts/setup-intel-llm.ps1.
  intel: { type: "openai", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b" },
};

/** Largest NVIDIA NIM model that is actually GRANTED + responsive on this account — the default
 * "expert"/builder brain (decision 2026-07-10: Anthropic keys are dead, so expert work runs on NIM).
 * Verified live 2026-07-19: 405b/3.3-70b/nemotron-70b are 404/timeout on this key; 3.1-70b answers.
 * Override with JARVIS_BUILDER_MODEL. When it does fail, the Router reroutes down NIM_FALLBACK_MODELS. */
const NIM_LARGE_MODEL = "meta/llama-3.1-70b-instruct";

/** Model reroute chain for NIM (verified responsive 2026-07-19). The Router walks this in order when the
 * requested model times out / 5xxs / is gone (404/410). Env override: VISHU_MODEL_FALLBACKS (CSV). */
const NIM_FALLBACK_MODELS = [
  "meta/llama-3.1-70b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1",
  "meta/llama-3.1-8b-instruct",
];

/** Which model the "builder"/expert role runs. JARVIS_BUILDER_MODEL always wins; else, when the default
 * provider is NVIDIA NIM, the largest NIM model; else the provider's own model (nothing to upgrade to).
 * ponytail: a model-string resolver, not a whole extra provider — the builder Router is still
 * roles.for("builder"); this only names the model that Router is asked for. */
export function resolveBuilderModel(env: NodeJS.ProcessEnv, provider: ProviderConfig): string {
  if (env.JARVIS_BUILDER_MODEL) return env.JARVIS_BUILDER_MODEL;
  const isNim = /nvidia|nim/i.test(provider.baseUrl);
  if (!isNim) return provider.model; // nothing to upgrade to
  return loadNimState(nimStateFile(env))?.builder ?? NIM_LARGE_MODEL; // weekly best-available, else safe default
}

/** Friendly preset names (gemini, nvidia, xai, …) — surfaced to the UI's provider/model switcher. */
export function providerPresets(): { name: string; model: string }[] {
  return Object.entries(PRESETS).map(([name, p]) => ({ name, model: p.model }));
}

/** Identify a provider from an API key's prefix — lets auto-detect recognise a key pasted straight into
 * VISHU_API_KEY (not just provider-named env vars). Order matters: specific prefixes before the bare sk-. */
function detectFromKey(key: string): string | undefined {
  if (key.startsWith("nvapi-")) return "nvidia";
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-or-")) return "openrouter";
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("AIza")) return "gemini";
  if (key.startsWith("fw_")) return "fireworks";
  if (key.startsWith("xai-")) return "xai";
  if (key.startsWith("pplx-")) return "perplexity";
  if (key.startsWith("sk-")) return "openai";
  return undefined;
}

/** Standard provider env-var names, scanned in order to auto-detect the provider + key when
 * VISHU_PROVIDER is unset. First one present wins. Each may hold a comma-separated list (N keys). */
const ENV_KEYS: { provider: string; env: string }[] = [
  { provider: "anthropic", env: "ANTHROPIC_API_KEY" },
  { provider: "openai", env: "OPENAI_API_KEY" },
  { provider: "gemini", env: "GEMINI_API_KEY" },
  { provider: "gemini", env: "GOOGLE_API_KEY" },
  { provider: "openrouter", env: "OPENROUTER_API_KEY" },
  { provider: "groq", env: "GROQ_API_KEY" },
  { provider: "deepseek", env: "DEEPSEEK_API_KEY" },
  { provider: "nvidia", env: "NVIDIA_API_KEY" },
  { provider: "mistral", env: "MISTRAL_API_KEY" },
  { provider: "together", env: "TOGETHER_API_KEY" },
  { provider: "fireworks", env: "FIREWORKS_API_KEY" },
  { provider: "xai", env: "XAI_API_KEY" },
  { provider: "perplexity", env: "PERPLEXITY_API_KEY" },
  { provider: "cohere", env: "COHERE_API_KEY" },
];

/** CSV or single value → trimmed list. Comma-separated = N keys for failover. */
function splitKeys(v?: string): string[] {
  return v ? v.split(",").map((k) => k.trim()).filter(Boolean) : [];
}

export function resolveProvider(
  env: NodeJS.ProcessEnv,
  file: { provider?: Partial<ProviderConfig> & { apiKeys?: KeyEntry[] } },
): ProviderConfig {
  // Auto-detect with no explicit provider: first a standard provider env var, then the key's own prefix
  // (so a key pasted into VISHU_API_KEY is recognised too), else the offline mock.
  // An explicit VISHU_API_KEY (and its prefix) outranks ambient provider env vars like a stray
  // ANTHROPIC_API_KEY left in the shell — the user pasted that key on purpose.
  const explicitKey = splitKeys(env.VISHU_API_KEYS)[0] || env.VISHU_API_KEY;
  const detected = ENV_KEYS.find((e) => env[e.env]);
  const name =
    env.VISHU_PROVIDER || file.provider?.type || (explicitKey ? detectFromKey(explicitKey) : undefined) || detected?.provider || "mock";

  // A friendly preset (gemini/openrouter/…) resolves to an adapter type + endpoint + default model.
  const preset = PRESETS[name];
  const type = (preset?.type ?? name) as ProviderType;

  // Keys, by precedence: VISHU_API_KEYS, VISHU_API_KEY, the provider's standard env var, then file.
  const stdEnv = ENV_KEYS.find((e) => e.provider === name)?.env;
  const entries: KeyEntry[] = splitKeys(env.VISHU_API_KEYS).length
    ? splitKeys(env.VISHU_API_KEYS)
    : env.VISHU_API_KEY
      ? [env.VISHU_API_KEY]
      : stdEnv && env[stdEnv]
        ? splitKeys(env[stdEnv])
        : file.provider?.apiKeys ?? [];

  const apiKeys: string[] = [];
  const keyLabels: string[] = [];
  entries.forEach((e, i) => {
    apiKeys.push(typeof e === "string" ? e : e.key);
    keyLabels.push((typeof e === "string" ? undefined : e.label) || defaultLabel(i));
  });

  const baseUrl = env.VISHU_BASE_URL || file.provider?.baseUrl || preset?.baseUrl || DEFAULT_BASE_URL[type];
  const envFallbacks = splitKeys(env.VISHU_MODEL_FALLBACKS);
  const isNim = /nvidia|nim/i.test(baseUrl);
  // Precedence: explicit env CSV > weekly auto-updated chain > hardcoded verified default.
  const nimChain = isNim ? loadNimState(nimStateFile(env))?.fallbacks ?? NIM_FALLBACK_MODELS : undefined;
  return {
    type,
    model: env.VISHU_MODEL || file.provider?.model || preset?.model || DEFAULT_MODEL[type],
    baseUrl,
    apiKeys,
    keyLabels,
    modelFallbacks: envFallbacks.length ? envFallbacks : nimChain,
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
    budgetUsd?: number;
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

  const budgetUsd = env.VISHU_BUDGET_USD ? Number(env.VISHU_BUDGET_USD) : file.budgetUsd ?? 0;

  return { paths, port, provider: resolveProvider(env, file), providers, roles: file.roles ?? {}, budgetUsd: budgetUsd > 0 ? budgetUsd : 0 };
}
