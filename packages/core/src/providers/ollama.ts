import { statusError } from "./transient.js";
import type { ChatRequest, ChatResponse, OnDelta, Provider, ToolCall } from "./types.js";

export interface OllamaConfig {
  name?: string;
  baseUrl: string;
}

/** Local Ollama adapter. ponytail: emit-once stream; NDJSON streaming is the upgrade path. */
export class OllamaProvider implements Provider {
  readonly name: string;
  constructor(private readonly cfg: OllamaConfig) {
    this.name = cfg.name ?? "ollama";
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(`${this.cfg.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        stream: false,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        tools: req.tools?.map((t) => ({ type: "function", function: t })),
      }),
    });
    if (!res.ok) throw statusError(res.status, await res.text());
    const json = (await res.json()) as {
      message?: { content?: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] };
      done_reason?: string;
    };
    const toolCalls: ToolCall[] | undefined = json.message?.tool_calls?.map((c, i) => ({
      id: `ollama-${i}`,
      name: c.function.name,
      arguments: c.function.arguments,
    }));
    return {
      content: json.message?.content ?? "",
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      finish: toolCalls?.length ? "tool_calls" : "stop",
    };
  }

  async chatStream(req: ChatRequest, onDelta: OnDelta): Promise<ChatResponse> {
    const res = await this.chat(req);
    if (res.content) onDelta(res.content);
    return res;
  }
}
