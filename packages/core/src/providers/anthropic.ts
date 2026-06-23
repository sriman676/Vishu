import { statusError } from "./transient.js";
import type { ChatRequest, ChatResponse, OnDelta, Provider, ToolCall } from "./types.js";

export interface AnthropicConfig {
  name?: string;
  baseUrl: string;
  apiKey: string;
  version?: string;
}

/** Native Anthropic Messages API adapter. ponytail: emit-once stream; real SSE is the upgrade path. */
export class AnthropicProvider implements Provider {
  readonly name: string;
  constructor(private readonly cfg: AnthropicConfig) {
    this.name = cfg.name ?? "anthropic";
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") || undefined;
    const messages = req.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch(`${this.cfg.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.cfg.apiKey,
        "anthropic-version": this.cfg.version ?? "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        system,
        messages,
        max_tokens: req.maxTokens ?? 4096,
        tools: req.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      }),
    });
    if (!res.ok) throw statusError(res.status, await res.text());
    const json = (await res.json()) as {
      content?: ({ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> })[];
      stop_reason?: string;
    };
    let content = "";
    const toolCalls: ToolCall[] = [];
    for (const block of json.content ?? []) {
      if (block.type === "text") content += block.text;
      else toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
    }
    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finish: toolCalls.length ? "tool_calls" : json.stop_reason === "max_tokens" ? "length" : "stop",
    };
  }

  async chatStream(req: ChatRequest, onDelta: OnDelta): Promise<ChatResponse> {
    const res = await this.chat(req);
    if (res.content) onDelta(res.content);
    return res;
  }
}
