import { statusError } from "./transient.js";
import type { ChatMessage, ChatRequest, ChatResponse, OnDelta, Provider, ToolCall } from "./types.js";

export interface OpenAIConfig {
  name?: string;
  baseUrl: string;
  apiKey: string;
  /** Embeddings model for semantic recall (Phase 7); defaults to a small OpenAI-style model. */
  embedModel?: string;
}

interface OAChoice {
  message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
  delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] };
  finish_reason?: string | null;
}

function toOpenAIMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === "tool") return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "assistant",
      content: m.content,
      tool_calls: m.toolCalls.map((t) => ({
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: JSON.stringify(t.arguments) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function parseToolCalls(raw: OAChoice["message"]): ToolCall[] | undefined {
  if (!raw?.tool_calls?.length) return undefined;
  return raw.tool_calls.map((c) => ({
    id: c.id,
    name: c.function.name,
    arguments: safeJson(c.function.arguments),
  }));
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** OpenAI-compatible chat client — covers OpenRouter, NVIDIA NIM, Google AI Studio, local servers. */
export class OpenAICompatibleProvider implements Provider {
  readonly name: string;
  constructor(private readonly cfg: OpenAIConfig) {
    this.name = cfg.name ?? "openai-compatible";
  }

  private headers(): Record<string, string> {
    return { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` };
  }

  private body(req: ChatRequest, stream: boolean): string {
    return JSON.stringify({
      model: req.model,
      messages: req.messages.map(toOpenAIMessage),
      tools: req.tools?.map((t) => ({ type: "function", function: t })),
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      stream,
    });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: this.body(req, false),
    });
    if (!res.ok) throw statusError(res.status, await res.text());
    const json = (await res.json()) as { choices?: OAChoice[] };
    const choice = json.choices?.[0];
    const toolCalls = parseToolCalls(choice?.message);
    return {
      content: choice?.message?.content ?? "",
      toolCalls,
      finish: toolCalls ? "tool_calls" : choice?.finish_reason === "length" ? "length" : "stop",
    };
  }

  async chatStream(req: ChatRequest, onDelta: OnDelta): Promise<ChatResponse> {
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: this.body(req, true),
    });
    if (!res.ok) throw statusError(res.status, await res.text());
    if (!res.body) return this.chat(req);

    let content = "";
    let finish: ChatResponse["finish"] = "stop";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        const choice = (JSON.parse(data) as { choices?: OAChoice[] }).choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) {
          content += delta;
          onDelta(delta);
        }
        if (choice?.finish_reason === "length") finish = "length";
      }
    }
    return { content, finish };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: this.cfg.embedModel ?? "text-embedding-3-small", input: texts }),
    });
    if (!res.ok) throw statusError(res.status, await res.text());
    const json = (await res.json()) as { data?: { embedding: number[] }[] };
    return (json.data ?? []).map((d) => d.embedding);
  }
}
