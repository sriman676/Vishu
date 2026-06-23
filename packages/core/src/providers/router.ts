import { isTransient } from "./transient.js";
import type { ChatRequest, ChatResponse, OnDelta, Provider } from "./types.js";

/**
 * Rotates through providers/keys on transient/quota errors (429/5xx/timeout); a fatal error
 * (e.g. 400/401) surfaces immediately. Each endpoint is one provider already bound to one key,
 * so iterating endpoints rotates both provider and key.
 */
export class Router {
  constructor(private readonly endpoints: Provider[]) {
    if (endpoints.length === 0) throw new Error("[router] no providers configured");
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    return this.run((p) => p.chat(req));
  }

  async chatStream(req: ChatRequest, onDelta: OnDelta): Promise<ChatResponse> {
    return this.run((p) => p.chatStream(req, onDelta));
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
