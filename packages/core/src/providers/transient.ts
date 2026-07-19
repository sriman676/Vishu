import { ProviderError } from "./types.js";

/** Canonical transient upstream statuses — single source of truth (doc 08). */
export const TRANSIENT_PROVIDER_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520]);

export function statusError(status: number, body: string): ProviderError {
  return new ProviderError(
    `upstream ${status}: ${body.slice(0, 200)}`,
    TRANSIENT_PROVIDER_HTTP_STATUSES.has(status),
    status,
  );
}

/** A model-level failure (the requested model is not found / retired) — worth retrying with a
 * DIFFERENT model rather than another key. NIM returns 404 (unknown/ungranted model) or 410 (retired). */
export function isModelUnavailable(e: unknown): boolean {
  return e instanceof ProviderError && (e.status === 404 || e.status === 410);
}

/** A failure worth rotating to the next provider/key (vs. a fatal one we should surface). */
export function isTransient(e: unknown): boolean {
  if (e instanceof ProviderError) return e.transient;
  // fetch network failures (refused/dns/timeout/abort) are transient.
  if (e instanceof Error) return /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout|aborted/i.test(e.message);
  return false;
}
