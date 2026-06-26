/** Run `fn` over `items` with at most `limit` in flight at once; results keep input order.
 * The lazy bounded-concurrency primitive for Vishu's I/O-bound fan-out (LLM calls, subprocesses, disk)
 * — no deps, no worker threads (the work waits on I/O, not CPU). `limit` defaults to "all at once".
 * ponytail: fixed worker pool over a shared cursor — no priority/cancellation; add those if a caller needs them. */
export async function parallelMap<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  limit = Infinity,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(limit, items.length));
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
  return results;
}
