import assert from "node:assert/strict";
import { test } from "node:test";
import { makeAsk } from "./ask.js";
import type { ApprovalRequest } from "./approvals.js";

const req: ApprovalRequest = { tool: "send_email", summary: "{}", klass: "safe", action: "send" };

test("makeAsk: denies (fail-closed) when no human is attending, without prompting", async () => {
  let prompted = false;
  const ask = makeAsk(async () => { prompted = true; return "y"; }, () => false);
  assert.equal(await ask(req), false);
  assert.equal(prompted, false);
});

test("makeAsk: y/yes allow, everything else denies", async () => {
  const answer = (s: string) => makeAsk(async () => s, () => true)(req);
  for (const yes of ["y", "Y", "yes", " Yes "]) assert.equal(await answer(yes), true, yes);
  for (const no of ["n", "", "nope", "yeah", "1"]) assert.equal(await answer(no), false, JSON.stringify(no));
});

test("makeAsk: serializes — the second prompt waits for the first to resolve", async () => {
  const order: string[] = [];
  let releaseFirst!: () => void;
  const first = new Promise<void>((r) => (releaseFirst = r));
  let call = 0;
  const ask = makeAsk(async () => {
    const which = ++call === 1 ? "first" : "second";
    order.push(`start:${which}`);
    if (which === "first") await first;
    order.push(`end:${which}`);
    return "y";
  }, () => true);

  const p1 = ask(req);
  const p2 = ask(req);
  await Promise.resolve(); // let microtasks settle: only the first should have started
  assert.deepEqual(order, ["start:first"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([p1, p2]), [true, true]);
  assert.deepEqual(order, ["start:first", "end:first", "start:second", "end:second"]);
});
