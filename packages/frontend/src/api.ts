// The same `vishu.*` JSON-RPC contract the CLI speaks, over the Vite proxy (same-origin /rpc, /events).

type RpcOutcome<T> = { ok: true; result: T } | { ok: false; error: { code: string; message: string } };
type JsonRpcResponse = { result?: RpcOutcome<unknown>; error?: { code: number; message: string } };

export async function rpc<T>(token: string, method: string, params?: unknown): Promise<T> {
  const res = await fetch("/rpc", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (res.status === 401) throw new Error("unauthorized — token mismatch (paste the core.token contents)");
  const body = (await res.json()) as JsonRpcResponse;
  if (body.error) throw new Error(body.error.message); // JSON-RPC protocol error
  const outcome = body.result;
  if (!outcome) throw new Error("empty response");
  if (!outcome.ok) throw new Error(outcome.error.message); // domain error envelope
  return outcome.result as T;
}

export interface TurnResult {
  sessionId: string;
  final: string;
  iterations: number;
  turns: number;
}

export const startTurn = (token: string, message: string, sessionId?: string) =>
  rpc<TurnResult>(token, "vishu.agent_start_turn", { message, sessionId });

export interface CategoryStat {
  category: string;
  calls: number;
  tokens: number;
  pct: number;
  usd: number;
}
export interface WasteItem {
  kind: "context_bloat" | "model_overkill" | "duplicate";
  calls: number;
  tokens: number;
  usd: number;
  action: string;
}
export interface TokenReport {
  days: number;
  totalCalls: number;
  totalTokens: number;
  totalUsd: number;
  byCategory: CategoryStat[];
  waste: WasteItem[];
  savingsTokens: number;
  savingsUsd: number;
}

export const tokenReport = (token: string, days = 7) =>
  rpc<TokenReport>(token, "vishu.token_report", { days });

/** Subscribe to the core's SSE bus (tool:sync, notifications). Returns an unsubscribe. */
export function subscribeEvents(token: string, onEvent: (e: unknown) => void): () => void {
  const es = new EventSource(`/events?token=${encodeURIComponent(token)}`);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      /* ignore non-JSON keepalives */
    }
  };
  return () => es.close();
}
