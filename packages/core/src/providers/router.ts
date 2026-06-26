import type { Cassette } from "../replay/cassette.js";
import type { UsageLog } from "../usage/log.js";
import { isTransient } from "./transient.js";
import type { ChatRequest, ChatResponse, OnDelta, Provider } from "./types.js";

const estimate = (text: string): number => Math.ceil(text.length / 4);

/**
 * Rotates through providers/keys on transient/quota errors (429/5xx/timeout); a fatal error
 * (e.g. 400/401) surfaces immediately. Each endpoint is one provider already bound to one key,
 * so iterating endpoints rotates both provider and key. Every model call funnels through here, so
 * it is also where token usage is captured (optional UsageLog) for the weekly token report.
 */
export class Router {
  constructor(
    private readonly endpoints: Provider[],
    private readonly usageLog?: UsageLog,
    private readonly cassette?: Cassette,
  ) {
    if (endpoints.length === 0) throw new Error("[router] no providers configured");
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const replayed = this.cassette?.get(req);
    if (replayed) {
      this.logUsage(req, replayed);
      return replayed;
    }
    const res = await this.run((p) => p.chat(req));
    this.cassette?.put(req, res);
    this.logUsage(req, res);
    return res;
  }

  async chatStream(req: ChatRequest, onDelta: OnDelta): Promise<ChatResponse> {
    const replayed = this.cassette?.get(req);
    if (replayed) {
      onDelta(replayed.content); // replay still drives streaming consumers
      this.logUsage(req, replayed);
      return replayed;
    }
    const res = await this.run((p) => p.chatStream(req, onDelta));
    this.cassette?.put(req, res);
    this.logUsage(req, res);
    return res;
  }

  /** Record one call's token usage; fall back to chars/4 when the provider/stream omits real usage. */
  private logUsage(req: ChatRequest, res: ChatResponse): void {
    if (!this.usageLog) return;
    this.usageLog.record({
      ts: Date.now(),
      model: req.model,
      category: req.category ?? "other",
      promptTokens: res.usage?.promptTokens ?? estimate(req.messages.map((m) => m.content).join("\n")),
      completionTokens: res.usage?.completionTokens ?? estimate(res.content),
    });
  }

  /** True if any endpoint can embed — lets memory decide whether to enable semantic recall. */
  canEmbed(): boolean {
    return this.endpoints.some((p) => p.embed);
  }

  /** Embed texts, skipping endpoints without embeddings and rotating on transient errors. */
  async embed(texts: string[]): Promise<number[][]> {
    let lastErr: unknown;
    for (const ep of this.endpoints) {
      if (!ep.embed) continue;
      try {
        return await ep.embed(texts);
      } catch (e) {
        if (!isTransient(e)) throw e;
        lastErr = e;
      }
    }
    throw lastErr ?? new Error("[router] no provider supports embeddings");
  }

  private async run<T>(call: (p: Provider) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (const ep of this.endpoints) {
      try {
        return await call(ep);
      } catch (e) {
        if (!isTransient(e)) throw e;
        lastErr = e;
        process.stderr.write(`[router] ${ep.name} transient failure, rotating: ${(e as Error).message}\n`);
      }
    }
    throw lastErr ?? new Error("[router] all providers exhausted");
  }
}
