/**
 * Best-available NIM model picker (user: "always have access to the top LLM NIM offers; check weekly").
 * NIM *lists* models it does not actually serve on a given tier (405b/3.3-70b are in /v1/models but 404 /
 * time out on the free key), so ranking the catalogue is not enough — every candidate is PINGED and only
 * a responding model is chosen. Returns the builder (largest that answers) + a fallback chain of the next
 * responders, always tailed by a small model as the last resort. Pure logic here; the live probe + persist
 * live in the CLI/weekly trigger. ponytail: parse params from the id, verify, pick — no vendor SDK.
 */

/** Params (in billions) advertised in a model id, e.g. "llama-3.1-70b"→70, "mistral-large-3-675b"→675,
 * "mixtral-8x22b"→22 (per-expert; MoE effective size is NOT computed — a known ceiling). 0 = untagged. */
export function parseParams(id: string): number {
  const nums = [...id.toLowerCase().matchAll(/(\d+)\s*b(?![a-z0-9])/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

/** Chat/instruct text models only — drop embeddings, vision, guard, code-completion, reranking, TTS, etc.
 * so the builder head is always a general reasoning model. */
export function isChatModel(id: string): boolean {
  const s = id.toLowerCase();
  if (!/(instruct|chat|nemotron|-it$|-it-|maverick|scout|mixtral|mistral-(large|medium|small))/.test(s)) return false;
  return !/(embed|rerank|guard|vision|ocr|code(llama|star|stral|gen)|starcoder|diffusion|tts|stt|whisper|-vl-|paraphrase|safety)/.test(s);
}

/** Catalogue ids → chat models ranked by advertised params, largest first (ties keep catalogue order). */
export function rankModels(ids: string[]): string[] {
  return ids
    .filter(isChatModel)
    .map((id, i) => ({ id, p: parseParams(id), i }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((x) => x.id);
}

export interface NimChain {
  builder: string;
  fallbacks: string[];
}

/**
 * Probe the catalogue and return the best working chain. `list()` yields model ids; `ping(id)` resolves
 * true iff that model actually answers. Only the top `verifyTop` ranked candidates are pinged (cost cap).
 * `smallTail` (a known-good cheap model) is always appended so the chain never dead-ends. Falls back to the
 * small tail alone if nothing large answers.
 */
export async function pickBestNimModels(
  list: () => Promise<string[]>,
  ping: (id: string) => Promise<boolean>,
  opts: { verifyTop?: number; smallTail?: string; want?: number } = {},
): Promise<NimChain> {
  const verifyTop = opts.verifyTop ?? 8;
  const smallTail = opts.smallTail ?? "meta/llama-3.1-8b-instruct";
  const want = opts.want ?? 3;
  const ranked = rankModels(await list()).slice(0, verifyTop);
  const working: string[] = [];
  for (const id of ranked) {
    if (working.length >= want) break;
    if (await ping(id)) working.push(id);
  }
  if (!working.includes(smallTail)) working.push(smallTail);
  return { builder: working[0]!, fallbacks: working };
}
