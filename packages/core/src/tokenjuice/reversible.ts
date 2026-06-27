/** Reversible compression (headroom's CCR pattern): when TokenJuice elides output to save tokens, the
 * original is stashed under a short ref the model can retrieve on demand — compression never loses data,
 * it defers it. ponytail: in-memory, bounded to the last N stashes per process; spill to disk under the
 * workspace if a turn needs the original after a restart. */
const store = new Map<string, string>();
let counter = 0;
const MAX = 50;

/** Stash an original and return a short ref to retrieve it later. */
export function stashOriginal(original: string): string {
  const ref = `orig-${(counter++).toString(36)}`;
  store.set(ref, original);
  if (store.size > MAX) store.delete(store.keys().next().value as string); // bound memory (FIFO)
  return ref;
}

/** Retrieve a stashed original by ref, or undefined if unknown/evicted. */
export function retrieveOriginal(ref: string): string | undefined {
  return store.get(ref);
}
