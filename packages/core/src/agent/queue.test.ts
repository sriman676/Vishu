import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentQueue } from "./queue.js";
import type { TurnResult } from "./service.js";

const tick = () => new Promise((r) => setTimeout(r, 10));

interface Deferred {
  promise: Promise<TurnResult>;
  resolve: (r: TurnResult) => void;
  reject: (e: Error) => void;
}
function deferred(): Deferred {
  let resolve!: (r: TurnResult) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<TurnResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const result = (final: string): TurnResult => ({ sessionId: "s", final, iterations: 1, turns: 1 });

test("AgentQueue: runs up to `concurrency` at once, queues the rest, then drains FIFO", async () => {
  const gates: Record<string, Deferred> = {};
  let inFlight = 0;
  let peak = 0;
  const run = (_sid: string | undefined, msg: string) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    gates[msg] = deferred();
    return gates[msg]!.promise.finally(() => (inFlight -= 1));
  };

  const q = new AgentQueue(run, 2);
  const a = q.enqueue("a");
  const b = q.enqueue("b");
  const c = q.enqueue("c");
  await tick();

  assert.equal(q.get(a.id)!.status, "running");
  assert.equal(q.get(b.id)!.status, "running");
  assert.equal(q.get(c.id)!.status, "queued"); // limit 2 → c waits
  assert.equal(peak, 2, "never more than 2 in flight");

  gates["a"]!.resolve(result("done-a"));
  await tick();
  assert.equal(q.get(a.id)!.status, "done");
  assert.equal(q.get(a.id)!.result!.final, "done-a");
  assert.equal(q.get(c.id)!.status, "running"); // freed slot pulled c

  gates["b"]!.reject(new Error("boom"));
  await tick();
  assert.equal(q.get(b.id)!.status, "error");
  assert.equal(q.get(b.id)!.error, "boom");

  gates["c"]!.resolve(result("done-c"));
  await tick();
  assert.equal(q.get(c.id)!.status, "done");
  assert.equal(q.list().length, 3);
});
