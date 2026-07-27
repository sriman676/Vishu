import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ProviderConfig, providerBaseConfig, providerEnvVar } from "../config/config.js";

/** THE KEY ASSIGNER (deterministic, no LLM). Scans the environment for every provider key present and
 * builds a ranked, tiered pool — so PA uses whatever keys exist and, when a new key is pasted (a renewed
 * NIM sub, a fresh MiniMax key), it auto-joins the pool on next boot with no code change. Routing is by
 * TIER: private/cheap/short work → local or free-tier; hard reasoning/coding → the best paid provider.
 * Liveness is by FAILOVER: the pooled Router walks the pool best-first, so a dead provider just falls
 * through (and an optional `vishu keys --probe` drops known-dead ones so they stop taxing latency). */

export type Tier = "local" | "cheap" | "premium";

export interface DiscoveredProvider {
  name: string;
  tier: Tier;
  /** Higher = preferred. Failover/default order = rank desc. */
  rank: number;
  /** How many API keys this provider pooled (NVIDIA folds in all the friend/aihub/strix NIM keys). */
  keyCount: number;
  cfg: ProviderConfig;
}

/** Tier + rank per known provider. `extraKeyEnvs` are additional keys folded into one provider as failover
 * endpoints (all the spare NVIDIA NIM keys live under `nvidia`). Ranks: premium 60-90, cheap 50-72,
 * local 45 — so the default brain prefers paid reasoning while cheap/local serve the fast lane. */
const CATALOG: { name: string; tier: Tier; rank: number; extraKeyEnvs?: string[] }[] = [
  // premium — paid / strongest reasoning; the default brain + builder run here.
  { name: "anthropic", tier: "premium", rank: 90 },
  { name: "openai", tier: "premium", rank: 85 },
  { name: "minimax", tier: "premium", rank: 82 },
  { name: "deepseek", tier: "premium", rank: 78 },
  { name: "xai", tier: "premium", rank: 74 },
  { name: "perplexity", tier: "premium", rank: 60 },
  // cheap — free-tier / fast cloud; the fast lane (classify/summarise/route) runs here. nvidia folds in
  // every spare NIM key so they rotate as failover under one provider.
  {
    name: "nvidia",
    tier: "cheap",
    rank: 72,
    extraKeyEnvs: ["NVIDIA_API_KEY_AIHUB", "NIM_API_KEY_FRIEND_1", "NIM_API_KEY_FRIEND_2", "NIM_API_KEY_FRIEND_3", "NIM_API_KEY_FRIEND_4", "NIM_API_KEY_STRIX"],
  },
  { name: "cerebras", tier: "cheap", rank: 70 },
  { name: "groq", tier: "cheap", rank: 68 },
  { name: "together", tier: "cheap", rank: 64 },
  { name: "deepinfra", tier: "cheap", rank: 62 },
  { name: "sambanova", tier: "cheap", rank: 60 },
  { name: "fireworks", tier: "cheap", rank: 58 },
  { name: "gemini", tier: "cheap", rank: 56 },
  { name: "mistral", tier: "cheap", rank: 54 },
  { name: "openrouter", tier: "cheap", rank: 52 },
  { name: "cohere", tier: "cheap", rank: 50 },
  { name: "huggingface", tier: "cheap", rank: 48 },
  { name: "cloudflare", tier: "cheap", rank: 46 },
];

/** CSV or single value → trimmed non-empty list (a provider env var may hold N comma-separated keys). */
function csv(v?: string): string[] {
  return v ? v.split(",").map((k) => k.trim()).filter(Boolean) : [];
}

/** Where the optional liveness report lives (written by `vishu keys --probe`). VISHU_KEYS_HEALTH overrides. */
export function keysHealthFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.VISHU_KEYS_HEALTH || join(process.cwd(), "keys-health.json");
}

/** Providers a fresh probe marked dead → dropped from discovery so they stop taxing failover latency.
 * Missing/unreadable/stale-schema file → empty set (optimistic: include everything, fail over at call time). */
function deadProviders(env: NodeJS.ProcessEnv): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(keysHealthFile(env), "utf8")) as { providers?: Record<string, { ok?: boolean }> };
    const dead = new Set<string>();
    for (const [name, h] of Object.entries(raw.providers ?? {})) if (h && h.ok === false) dead.add(name);
    return dead;
  } catch {
    return new Set();
  }
}

/** Scan env → the available provider pool, ranked best-first. A provider is included when its key env var
 * (or any of its extra key envs) holds at least one key AND it isn't marked dead by a recent probe. */
export function discoverProviders(env: NodeJS.ProcessEnv = process.env): DiscoveredProvider[] {
  const dead = deadProviders(env);
  const out: DiscoveredProvider[] = [];

  // On-device model (free, private) — the fast lane prefers it. Only when a local endpoint is configured.
  if (env.VISHU_LOCAL_BASE_URL && !dead.has("local")) {
    out.push({
      name: "local",
      tier: "local",
      rank: 45,
      keyCount: 0,
      cfg: { type: "ollama", model: env.VISHU_LOCAL_MODEL ?? "", baseUrl: env.VISHU_LOCAL_BASE_URL, apiKeys: [], keyLabels: [] },
    });
  }

  for (const entry of CATALOG) {
    if (dead.has(entry.name)) continue;
    const envVars = [providerEnvVar(entry.name), ...(entry.extraKeyEnvs ?? [])].filter(Boolean) as string[];
    const apiKeys: string[] = [];
    const keyLabels: string[] = [];
    for (const ev of envVars) for (const k of csv(env[ev])) {
      apiKeys.push(k);
      keyLabels.push(ev);
    }
    if (!apiKeys.length) continue; // no key present → provider unavailable
    const base = providerBaseConfig(entry.name);
    // Cloudflare's endpoint embeds the account id; without it the URL can't resolve → skip the provider.
    if (base.baseUrl.includes("{account_id}")) {
      const acct = env.CLOUDFLARE_ACCOUNT_ID;
      if (!acct) continue;
      base.baseUrl = base.baseUrl.replace("{account_id}", acct);
    }
    out.push({ name: entry.name, tier: entry.tier, rank: entry.rank, keyCount: apiKeys.length, cfg: { ...base, apiKeys, keyLabels } });
  }

  return out.sort((a, b) => b.rank - a.rank);
}

/** Discovered list → the `providers` pool (name → ProviderConfig), insertion-ordered best-first so the
 * pooled Router fails over top-tier → down. */
export function toPool(list: DiscoveredProvider[]): Record<string, ProviderConfig> {
  const pool: Record<string, ProviderConfig> = {};
  for (const p of list) pool[p.name] = p.cfg;
  return pool;
}

/** Discovered list → role→provider assignments (the per-task tier routing). Only the cheap, high-frequency
 * fast-lane roles get pinned — to the best cheap provider (embedder → local when present) — so classify/
 * summarise/route work stays off the premium quota. Hard roles (brain/builder/judge/main) are LEFT
 * UNASSIGNED on purpose: they fall through to the pooled default Router, which spans every provider
 * best-first with failover — so hard reasoning prefers premium yet self-heals when a top provider is down,
 * and the existing builder-model logic (resolveBuilderModel / big-NIM) keeps working untouched. */
export function assignRoles(list: DiscoveredProvider[]): Record<string, string> {
  const roles: Record<string, string> = {};
  const inTier = (t: Tier) => list.filter((p) => p.tier === t); // already rank-sorted
  const topCheap = inTier("cheap")[0]?.name ?? inTier("local")[0]?.name;
  const topLocal = inTier("local")[0]?.name ?? topCheap;

  if (topCheap) for (const r of ["fast", "worker", "summariser", "classifier"]) roles[r] = topCheap;
  if (topLocal) roles.embedder = topLocal;
  return roles;
}
