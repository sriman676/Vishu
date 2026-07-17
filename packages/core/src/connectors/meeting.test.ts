import assert from "node:assert/strict";
import { test } from "node:test";
import type { MemoryStore } from "../memory/store.js";
import type { Router } from "../providers/router.js";
import { Registry } from "../transport/rpc.js";
import { joinMeeting, parseSummary, registerMeeting, summarizeTranscript } from "./meeting.js";

const TRANSCRIPT = "Alice: ship Friday. Bob: I'll write the migration. Alice: agreed, freeze main Thursday.";
// A scripted router standing in for the provider — returns the summary JSON the model would produce.
const scripted = (content: string): Router => ({ chat: async () => ({ content }) }) as unknown as Router;

test("parseSummary: extracts JSON, degrades to plain text on a non-JSON reply", () => {
  const good = parseSummary('prefix {"summary":"s","decisions":["d"],"actionItems":["bob: migration"]} suffix');
  assert.deepEqual(good, { summary: "s", decisions: ["d"], actionItems: ["bob: migration"] });
  const bad = parseSummary("no json here, just prose");
  assert.equal(bad.summary, "no json here, just prose");
  assert.deepEqual(bad.decisions, []);
});

test("§12e summarizeTranscript: a transcript becomes a structured summary through the router", async () => {
  const router = scripted('{"summary":"Team will ship Friday.","decisions":["Freeze main Thursday"],"actionItems":["Bob: write migration"]}');
  const s = await summarizeTranscript(router, "test-model", TRANSCRIPT);
  assert.equal(s.summary, "Team will ship Friday.");
  assert.deepEqual(s.decisions, ["Freeze main Thursday"]);
  assert.deepEqual(s.actionItems, ["Bob: write migration"]);
});

test("joinMeeting: live join is scaffolded — reports owed, never fakes a join", () => {
  const r = joinMeeting("zoom", "https://zoom.us/j/123");
  assert.equal(r.joined, false);
  assert.match(r.owed, /not wired/);
});

test("§12e meeting RPC: summarize files a vault note + returns the summary; join reports owed; empty rejected", async () => {
  const filed: { type: string; subject: string; content: string }[] = [];
  const memory = { put: async (n: { type: string; subject: string; content: string }) => void filed.push(n) } as unknown as MemoryStore;
  const rpc = new Registry();
  registerMeeting(rpc, {
    router: scripted('{"summary":"gist","decisions":[],"actionItems":["Bob: migration"]}'),
    model: "test-model",
    memory,
  });
  const call = (method: string, params: unknown) => rpc.handle({ jsonrpc: "2.0", id: 1, method, params });

  const sum = await call("vishu.meeting_summarize", { transcript: TRANSCRIPT, title: "Ship sync" });
  assert.equal(sum.result?.ok, true);
  assert.equal((sum.result as { result: { summary: string } }).result.summary, "gist");
  assert.equal(filed.length, 1); // filed to the vault
  assert.match(filed[0].content, /Bob: migration/);
  assert.match(filed[0].subject, /^meeting-Ship-sync/);

  const join = await call("vishu.meeting_join", { platform: "meet", url: "https://meet.google.com/x" });
  assert.equal((join.result as { result: { joined: boolean } }).result.joined, false);

  assert.equal((await call("vishu.meeting_summarize", { transcript: "  " })).result?.ok, false); // empty rejected
});
