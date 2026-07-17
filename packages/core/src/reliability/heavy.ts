/**
 * §4b resource cap — one heavy subsystem at a time. Local LLM, the browser (persistent Chrome), and the
 * voice sidecars (whisper.cpp STT / Piper TTS) each eat a lot of RAM; on a 16 GB box, letting them all
 * spin up at once thrashes. This is a tiny async counting semaphore: `JARVIS_MAX_HEAVY` (default 1) heavy
 * operations run concurrently; the rest queue FIFO and resume as slots free.
 *
 * ponytail: FIFO promise queue, no priorities/timeouts/fairness knobs until a real need shows up. The slot
 * is handed straight from a releaser to the next waiter (never decremented to a free state with a waiter
 * present) so a third caller can't slip past the cap in the release→resume window.
 */
let active = 0;
const waiters: Array<() => void> = [];

/** Concurrency cap: `JARVIS_MAX_HEAVY` if set to a finite int ≥ 1, else 1. */
export function maxHeavy(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.JARVIS_MAX_HEAVY);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Acquire one heavy slot, awaiting if the cap is reached. Returns an idempotent release fn. */
export async function acquireHeavy(): Promise<() => void> {
  if (active < maxHeavy()) active++;
  else await new Promise<void>((resolve) => waiters.push(resolve)); // slot handed to us on release; no ++
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiters.shift();
    if (next) next(); // hand the slot straight to the next waiter — active stays put
    else active--;
  };
}

/** Run `fn` holding one heavy slot; always releases, even on throw. */
export async function withHeavy<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireHeavy();
  try {
    return await fn();
  } finally {
    release();
  }
}
