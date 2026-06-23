/** Domain-level result envelope — every RPC method returns this (PLAN.md contract). */
export type RpcOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; message: string; data?: unknown } };

export const ok = <T>(result: T): RpcOutcome<T> => ({ ok: true, result });
export const err = (code: string, message: string, data?: unknown): RpcOutcome<never> => ({
  ok: false,
  error: { code, message, data },
});

export type RpcHandler = (params: unknown) => RpcOutcome<unknown> | Promise<RpcOutcome<unknown>>;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: RpcOutcome<unknown>;
  error?: { code: number; message: string };
}

/** Controller registry — domains register `vishu.<ns>_<fn>` handlers here (the `all.rs` pattern). */
export class Registry {
  private readonly handlers = new Map<string, RpcHandler>();

  register(method: string, handler: RpcHandler): void {
    if (this.handlers.has(method)) throw new Error(`[rpc] duplicate method: ${method}`);
    this.handlers.set(method, handler);
  }

  methods(): string[] {
    return [...this.handlers.keys()].sort();
  }

  /** Dispatch one parsed request to its handler, wrapping protocol + handler errors. */
  async handle(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = req?.id ?? null;
    if (req?.jsonrpc !== "2.0" || typeof req?.method !== "string") {
      return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } };
    }
    const handler = this.handlers.get(req.method);
    if (!handler) {
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
    }
    try {
      return { jsonrpc: "2.0", id, result: await handler(req.params) };
    } catch (e) {
      // ponytail: handler crash → typed envelope error, never an unhandled 500 body.
      const message = e instanceof Error ? e.message : String(e);
      return { jsonrpc: "2.0", id, result: err("internal", message) };
    }
  }
}
