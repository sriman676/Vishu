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
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  finish: "stop" | "tool_calls" | "length";
}

export type OnDelta = (text: string) => void;

/** Same trait for cloud + local backends so the harness stays backend-agnostic (doc 08). */
export interface Provider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** Stream sinks surface partial output incrementally; returns the assembled final response. */
  chatStream(req: ChatRequest, onDelta: OnDelta): Promise<ChatResponse>;
}

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
