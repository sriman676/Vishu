import { isQwen3, makeThinkFilter, stripThink, withNoThink } from "./qwen3.js";
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

/** Serialize a message's content for the OpenAI/NIM/OpenRouter chat API. With images attached it becomes
 * the multimodal parts array ([{type:text},{type:image_url}]); without, it stays a plain string so
 * text-only calls are byte-identical to before. Exported for testing. */
export function toOpenAIContent(m: ChatMessage): string | Array<Record<string, unknown>> {
  if (!m.images?.length) return m.content;
  const parts: Array<Record<string, unknown>> = [];
  if (m.content) parts.push({ type: "text", text: m.content });
  for (const url of m.images) parts.push({ type: "image_url", image_url: { url } });
  return parts;
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
  return { role: m.role, content: toOpenAIContent(m) };
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
    const tools = req.tools?.map((t) => ({ type: "function", function: t }));
    const messages = isQwen3(req.model) ? withNoThink(req.messages) : req.messages;
    return JSON.stringify({
      model: req.model,
      messages: messages.map(toOpenAIMessage),
      tools,
      // NIM's llama models reject parallel tool-calls ("only supports single tool-calls at once");
      // force one-at-a-time whenever tools are offered. Harmless on providers that allow parallel.
      ...(tools?.length ? { parallel_tool_calls: false } : {}),
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
    const json = (await res.json()) as { choices?: OAChoice[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const choice = json.choices?.[0];
    const toolCalls = parseToolCalls(choice?.message);
    const raw = choice?.message?.content ?? "";
    return {
      content: isQwen3(req.model) ? stripThink(raw) : raw,
      toolCalls,
      finish: toolCalls ? "tool_calls" : choice?.finish_reason === "length" ? "length" : "stop",
      usage: json.usage ? { promptTokens: json.usage.prompt_tokens ?? 0, completionTokens: json.usage.completion_tokens ?? 0 } : undefined,
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
    const qwen = isQwen3(req.model);
    const filter = qwen ? makeThinkFilter() : null;
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
          const visible = filter ? filter(delta) : delta;
          if (visible) onDelta(visible);
        }
        if (choice?.finish_reason === "length") finish = "length";
      }
    }
    return { content: qwen ? stripThink(content) : content, finish };
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
