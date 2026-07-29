export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string; // set when role === "tool"
  name?: string;
  /** Multimodal: image URLs (http(s) or data: URLs) attached to a user turn. Vision-capable providers
   * serialize these into their image format; providers without vision ignore them and see text only. */
  images?: string[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** Where this call comes from (agent/appbuilder/orchestration/…) — drives the token report. */
  category?: string;
  /** Extended-thinking budget (Anthropic). Set ONLY for orchestrator/decision calls; providers that
   * don't support it ignore it. maxTokens is floored above the budget by the provider. */
  thinking?: { budgetTokens: number };
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  finish: "stop" | "tool_calls" | "length";
  /** Real provider usage when reported; absent for streams/providers that omit it (then estimated). */
  usage?: { promptTokens: number; completionTokens: number };
}

export type OnDelta = (text: string) => void;

/** Same trait for cloud + local backends so the harness stays backend-agnostic (doc 08). */
export interface Provider {
  readonly name: string;
  /** True for on-device backends (ollama). The Router's "local" key-mode routes only to these. */
  readonly local?: boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** Stream sinks surface partial output incrementally; returns the assembled final response. */
  chatStream(req: ChatRequest, onDelta: OnDelta): Promise<ChatResponse>;
  /** Optional embeddings for semantic memory recall (Phase 7). Not every backend supports it. */
  embed?(texts: string[]): Promise<number[][]>;
}

/** A function that turns texts into vectors — satisfied by Router.embed; consumed by memory recall. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
