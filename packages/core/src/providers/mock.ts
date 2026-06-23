import type { ChatRequest, ChatResponse, OnDelta, Provider } from "./types.js";

/** Echoes the last user message — lets `vishu chat` run offline with no keys. */
export class EchoProvider implements Provider {
  readonly name = "mock";

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const last = [...req.messages].reverse().find((m) => m.role === "user");
    return { content: `echo: ${last?.content ?? ""}`, finish: "stop" };
  }

  async chatStream(req: ChatRequest, onDelta: OnDelta): Promise<ChatResponse> {
    const res = await this.chat(req);
    onDelta(res.content);
    return res;
  }

  /** Deterministic token-hash embedding: shared tokens → higher cosine. Lets semantic recall run
   * offline with no keys. ponytail: not a real semantic model — swap in a provider embedding for
   * meaning beyond literal token overlap. */
  async embed(texts: string[]): Promise<number[][]> {
    const dim = 64;
    return texts.map((t) => {
      const v = new Array<number>(dim).fill(0);
      for (const tok of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let h = 0;
        for (const ch of tok) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        const i = h % dim;
        v[i] = (v[i] ?? 0) + 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}

/** Returns a scripted sequence of responses/errors — used to test failover and the tool loop. */
export class ScriptedProvider implements Provider {
  private i = 0;
  constructor(
    private readonly script: (ChatResponse | Error)[],
    readonly name = "scripted",
  ) {}

  async chat(): Promise<ChatResponse> {
    const step = this.script[Math.min(this.i, this.script.length - 1)];
    this.i += 1;
    if (!step) return { content: "", finish: "stop" };
    if (step instanceof Error) throw step;
    return step;
  }

  async chatStream(_req: ChatRequest, onDelta: OnDelta): Promise<ChatResponse> {
    const res = await this.chat();
    onDelta(res.content);
    return res;
  }
}
