import { pathToFileURL } from "node:url";
import { Router } from "../providers/router.js";
import { ProviderError, type ChatRequest, type ChatResponse, type OnDelta, type Provider } from "../providers/types.js";

/**
 * A stand-in for one provider key with a hard per-burst budget: the first `capacity` calls succeed,
 * every call after that returns a 429 (transient) — exactly how a throttled upstream behaves under a
 * burst. Deterministic (no timers): the outcome depends only on how many calls the key is handed, so
 * the bench result is reproducible and needs no real keys or network.
 */
export class ThrottledKey implements Provider {
  private used = 0;
  constructor(
    readonly name: string,
    private readonly capacity: number,
  ) {}
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    if (this.used >= this.capacity) throw new ProviderError(`upstream 429: rate limit on ${this.name}`, true, 429);
    this.used += 1;
    return { content: "ok", finish: "stop" };
  }
  async chatStream(req: ChatRequest, onDelta: OnDelta): Promise<ChatResponse> {
    const r = await this.chat(req);
    onDelta(r.content);
    return r;
  }
}

const REQ: ChatRequest = { model: "bench", messages: [{ role: "user", content: "ping" }] };

/** Fire `n` calls at a router; count how many complete vs. die on a 429 the ring couldn't absorb. */
async function fire(router: Router, n: number): Promise<number> {
  const results = await Promise.allSettled(Array.from({ length: n }, () => router.chat(REQ)));
  return results.filter((r) => r.status === "fulfilled").length;
}

export interface BenchResult {
  n: number;
  singleClient: number; // OpenWorker-style: one key, no ring
  failover: number; // Vishu failover: throttled key + backups, rotate on 429
  balance: number; // Vishu balance: round-robin the same ring
}

/**
 * Compare a single throttled key (no ring) against Vishu's key-ring under a burst of `n` concurrent
 * calls. The ring is the same throttled key plus `backups` more keys of `capacity` each — so the
 * ring's total headroom is (backups+1)*capacity. This is the structural throughput wedge OpenWorker
 * lacks (its router builds one client per provider from a single api_key), made into a number.
 */
export async function bench(n = 40, capacity = 10, backups = 3): Promise<BenchResult> {
  const ring = (): Provider[] => [new ThrottledKey("primary", capacity), ...Array.from({ length: backups }, (_, i) => new ThrottledKey(`backup${i + 1}`, capacity))];
  return {
    n,
    singleClient: await fire(new Router([new ThrottledKey("primary", capacity)]), n),
    failover: await fire(new Router(ring(), undefined, undefined, "failover"), n),
    balance: await fire(new Router(ring(), undefined, undefined, "balance"), n),
  };
}

// Run directly: `npx tsx src/reliability/ratelimit-bench.ts`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  bench().then((r) => {
    process.stdout.write(
      `rate-limit bench — ${r.n} concurrent calls, keys of capacity 10:\n` +
        `  single client (no ring): ${r.singleClient}/${r.n} completed\n` +
        `  Vishu failover:          ${r.failover}/${r.n} completed\n` +
        `  Vishu balance:           ${r.balance}/${r.n} completed\n`,
    );
  });
}
