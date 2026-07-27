import { readFileSync, writeFileSync } from "node:fs";
import { type NimChain, pickBestNimModels } from "./nimcatalog.js";

/** Persisted best-available NIM chain (written by the weekly refresh, read by config at startup). */
export interface NimState extends NimChain {
  ts: number; // last refresh (epoch ms) — lets a staleness check trigger a re-probe
}

const NIM_BASE = "https://integrate.api.nvidia.com/v1";

/** Live catalogue lister + model pinger for a real NIM key. A ping = a 4-token chat call; 200 ⇒ served.
 * Catalogue-listed-but-unserved models (405b/3.3-70b on the free tier) fail the ping and are skipped. */
export function liveNimProbe(key: string, baseUrl = NIM_BASE, fetchImpl: typeof fetch = fetch) {
  const list = async (): Promise<string[]> => {
    const res = await fetchImpl(`${baseUrl}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => m.id);
  };
  const ping = async (id: string): Promise<boolean> => {
    try {
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: id, messages: [{ role: "user", content: "hi" }], max_tokens: 2 }),
        signal: AbortSignal.timeout(20_000), // a hung endpoint (e.g. 3.3-70b) counts as unavailable
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  return { list, ping };
}

/** Probe live NIM, pick the best working chain, persist it to `stateFile`, and return it. Called by
 * `vishu models refresh` and the weekly trigger. Never throws on a bad probe — returns the small-tail chain. */
export async function refreshNimModels(key: string, stateFile: string, baseUrl = NIM_BASE): Promise<NimState> {
  const { list, ping } = liveNimProbe(key, baseUrl);
  let chain: NimChain;
  try {
    chain = await pickBestNimModels(list, ping);
  } catch {
    chain = { builder: "meta/llama-3.1-8b-instruct", fallbacks: ["meta/llama-3.1-8b-instruct"] };
  }
  const state: NimState = { ...chain, ts: Date.now() };
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

/** Read the persisted chain (or undefined if missing/invalid) — config prefers it over the hardcoded default. */
export function loadNimState(stateFile: string): NimState | undefined {
  try {
    const s = JSON.parse(readFileSync(stateFile, "utf8")) as NimState;
    return s.builder && Array.isArray(s.fallbacks) ? s : undefined;
  } catch {
    return undefined;
  }
}
