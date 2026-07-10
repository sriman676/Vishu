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

    // Extended thinking (orchestrator/decision calls only). API requires max_tokens > budget_tokens.
    const budget = req.thinking?.budgetTokens;
    const maxTokens = budget ? Math.max(req.maxTokens ?? 4096, budget + 1024) : req.maxTokens ?? 4096;

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
        max_tokens: maxTokens,
        ...(budget ? { thinking: { type: "enabled", budget_tokens: budget } } : {}),
        tools: req.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      }),
    });
    if (!res.ok) throw statusError(res.status, await res.text());
    const json = (await res.json()) as {
      content?: ({ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } | { type: "thinking" | "redacted_thinking" })[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    let content = "";
    const toolCalls: ToolCall[] = [];
    for (const block of json.content ?? []) {
      if (block.type === "text") content += block.text;
      else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
      // thinking/redacted_thinking blocks are internal reasoning — not surfaced.
    }
    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finish: toolCalls.length ? "tool_calls" : json.stop_reason === "max_tokens" ? "length" : "stop",
      usage: json.usage ? { promptTokens: json.usage.input_tokens ?? 0, completionTokens: json.usage.output_tokens ?? 0 } : undefined,
    };
  }

  async chatStream(req: ChatRequest, onDelta: OnDelta): Promise<ChatResponse> {
    const res = await this.chat(req);
    if (res.content) onDelta(res.content);
    return res;
  }
}
