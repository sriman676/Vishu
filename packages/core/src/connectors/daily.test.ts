import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryStore } from "../memory/store.js";
import { ScriptedProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import { EventBus } from "../transport/events.js";
import { buildBriefing, openMatter, matchMatters, parseTask, processDaily, StubMailConnector, StubCalendar } from "./daily.js";

test("parseTask: reads TASK/DUE, returns null when the model says none", () => {
  assert.deepEqual(parseTask("TASK: send the invoice\nDUE: 2026-07-20"), { task: "send the invoice", due: "2026-07-20" });
  assert.deepEqual(parseTask("TASK: reply\nDUE: none"), { task: "reply", due: undefined });
  assert.equal(parseTask("TASK: none\nDUE: none"), null);
});

test("matchMatters: cosine/lexical-matches an inbound against open Matters, filters non-matters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-matters-"));
  const memory = new MemoryStore(join(dir, "vault"), join(dir, "mem.db"));
  await openMatter(memory, "acme-renewal", "Acme Corp contract renewal negotiation, due end of quarter");
  await memory.put({ type: "fact", subject: "unrelated", content: "the cat likes tuna" });

  const hits = await matchMatters(memory, "following up on the Acme contract renewal terms");
  assert.equal(hits.length, 1);
  assert.match(hits[0].body, /Acme/);
  memory.close();
});

test("processDaily: triages, files a to-do, drafts a reply into the draft lane on needs_action", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-daily-"));
  const memory = new MemoryStore(join(dir, "vault"), join(dir, "mem.db"));
  const bus = new EventBus();
  const notes: unknown[] = [];
  bus.subscribeDomain("system", (e) => e.type === "notification" && notes.push(e.payload));
  // Three scripted turns in order: triage → task-extract → draft-reply.
  const router = new Router([
    new ScriptedProvider([
      { content: "SUMMARY: client wants the report by Friday\nTIER: needs_action", finish: "stop" },
      { content: "TASK: send the Q3 report\nDUE: Friday", finish: "stop" },
      { content: "Sure — I'll get the Q3 report over to you by Friday.", finish: "stop" },
    ]),
  ]);

  const res = await processDaily(
    { router, model: "mock", memory, bus },
    { channel: "email", from: "client@x.com", text: "Can you send me the Q3 report by Friday?", id: "e1" },
  );

  assert.equal(res.triage.tier, "needs_action");
  assert.deepEqual(res.task, { task: "send the Q3 report", due: "Friday" });
  assert.match(res.draft ?? "", /Q3 report/);
  assert.ok(notes.some((n) => (n as { kind?: string }).kind === "draft_ready"));
  assert.match((await memory.recall("Q3 report todo")).text, /\[ \] send the Q3 report/); // to-do filed
  assert.match((await memory.recall("reply draft Q3")).text, /I'll get the Q3 report/); // draft filed, not sent
  memory.close();
});

test("buildBriefing: digests open to-dos/matters into one message, empty on a quiet day", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-brief-"));
  const memory = new MemoryStore(join(dir, "vault"), join(dir, "mem.db"));
  const router = new Router([new ScriptedProvider([{ content: "You have 1 to-do: send the Q3 report.", finish: "stop" }])]);
  assert.equal(await buildBriefing(memory, router, "mock"), ""); // nothing filed yet → quiet

  await memory.put({ type: "todo", subject: "t1", content: "- [ ] send the Q3 report (due: Friday)" });
  const brief = await buildBriefing(memory, router, "mock");
  assert.match(brief, /Q3 report/);
  memory.close();
});

test("stub connectors are unconfigured and throw until creds are wired", async () => {
  const mail = new StubMailConnector(undefined);
  const cal = new StubCalendar(undefined);
  assert.equal(mail.configured, false);
  assert.equal(cal.configured, false);
  await assert.rejects(mail.send("a@b.com", "hi"), /not configured/);
  await assert.rejects(cal.listEvents("2026-07-01", "2026-07-31"), /not configured/);
});
