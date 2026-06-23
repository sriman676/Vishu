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
