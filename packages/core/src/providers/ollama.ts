import { isQwen3, stripThink, withNoThink } from "./qwen3.js";
import { statusError } from "./transient.js";
import type { ChatRequest, ChatResponse, OnDelta, Provider, ToolCall } from "./types.js";

export interface OllamaConfig {
  name?: string;
  baseUrl: string;
}

/** Ollama wants raw base64 image data; strip a `data:...;base64,` prefix if present. An http URL passes
 * through unchanged (local vision expects base64/data URLs, so that simply won't resolve — a clean degrade). */
export function stripDataUrl(url: string): string {
  const comma = url.startsWith("data:") ? url.indexOf(",") : -1;
  return comma >= 0 ? url.slice(comma + 1) : url;
}

/** Local Ollama adapter. ponytail: emit-once stream; NDJSON streaming is the upgrade path. */
export class OllamaProvider implements Provider {
  readonly name: string;
  readonly local = true; // on-device — eligible for the Router's "local" key-mode
  constructor(private readonly cfg: OllamaConfig) {
    this.name = cfg.name ?? "ollama";
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    // Qwen3 defaults to a <think> block (slow, token-wasteful on the cheap local lane). Suppress it
    // both ways: /no_think prompt token + Ollama's native `think:false` field. ponytail: no-op on the
    // Thinking-only finetunes (Qwen3-*-Thinking-2507 hardcode <think> in their template); use a hybrid
    // or Instruct model to get the win.
    const qwen = isQwen3(req.model);
    const messages = qwen ? withNoThink(req.messages) : req.messages;
    const res = await fetch(`${this.cfg.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        stream: false,
        ...(qwen ? { think: false } : {}),
        // Ollama vision (llava etc.): images ride a base64 `images[]` field on the message (no data: prefix).
        messages: messages.map((m) => ({ role: m.role, content: m.content, ...(m.images?.length ? { images: m.images.map(stripDataUrl) } : {}) })),
        tools: req.tools?.map((t) => ({ type: "function", function: t })),
      }),
    });
    if (!res.ok) throw statusError(res.status, await res.text());
    const json = (await res.json()) as {
      message?: { content?: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] };
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const toolCalls: ToolCall[] | undefined = json.message?.tool_calls?.map((c, i) => ({
      id: `ollama-${i}`,
      name: c.function.name,
      arguments: c.function.arguments,
    }));
    const raw = json.message?.content ?? "";
    return {
      content: qwen ? stripThink(raw) : raw,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      finish: toolCalls?.length ? "tool_calls" : "stop",
      usage:
        json.prompt_eval_count !== undefined || json.eval_count !== undefined
          ? { promptTokens: json.prompt_eval_count ?? 0, completionTokens: json.eval_count ?? 0 }
          : undefined,
    };
  }

  async chatStream(req: ChatRequest, onDelta: OnDelta): Promise<ChatResponse> {
    const res = await this.chat(req);
    if (res.content) onDelta(res.content);
    return res;
  }
}
