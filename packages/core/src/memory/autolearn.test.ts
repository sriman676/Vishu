import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasDurableMarker, extractFact, learnFromTurn } from "./autolearn.js";
import { MemoryStore } from "./store.js";

test("heuristic gate: durable markers vs transient task talk", () => {
  assert.equal(hasDurableMarker("my name is Sriman"), true);
  assert.equal(hasDurableMarker("I prefer dark mode"), true);
  assert.equal(hasDurableMarker("remember that I use pnpm"), true);
  // transient turns must NOT match — they never trigger a model call
  assert.equal(hasDurableMarker("run the tests"), false);
  assert.equal(hasDurableMarker("I am running the build now"), false);
  assert.equal(hasDurableMarker("fix the failing test"), false);
});

test("extractFact: no marker => no model call", async () => {
  let called = false;
  const fact = await extractFact("run the tests", async () => {
    called = true;
    return "{}";
  });
  assert.equal(called, false);
  assert.equal(fact, null);
});

test("extractFact: parses JSON fact", async () => {
  const fact = await extractFact("my name is Sriman", async () => '{"subject":"name","fact":"The user\'s name is Sriman."}');
  assert.deepEqual(fact, { subject: "name", content: "The user's name is Sriman." });
});

test("extractFact: NONE and noise return null (noise guard)", async () => {
  assert.equal(await extractFact("I prefer nothing durable", async () => "NONE"), null);
  assert.equal(await extractFact("I use something", async () => "not json at all"), null);
  assert.equal(await extractFact("I like it", async () => '{"subject":"","fact":""}'), null);
});

test("learnFromTurn: writes a durable fact to memory under core", async () => {
  const dir = mkdtempSync(join(tmpdir(), "autolearn-"));
  const mem = new MemoryStore(join(dir, "vault"), join(dir, "db.sqlite"));
  const note = await learnFromTurn(mem, async () => '{"subject":"name","fact":"The user goes by Sriman."}', "call me Sriman");
  assert.ok(note);
  assert.equal(note.folder, "core");
  assert.match(note.body, /Sriman/);
  assert.equal(note.subject, "user:name");

  // restating supersedes instead of duplicating (subject key)
  await learnFromTurn(mem, async () => '{"subject":"Name","fact":"The user goes by Sri."}', "actually call me Sri");
  const live = mem.notes().filter((n) => n.subject === "user:name" && !n.supersededBy);
  assert.equal(live.length, 1);
  assert.match(live[0].body, /Sri\b/);
});

test("learnFromTurn: transient turn writes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "autolearn-"));
  const mem = new MemoryStore(join(dir, "vault"), join(dir, "db.sqlite"));
  const note = await learnFromTurn(mem, async () => "NONE", "run the tests");
  assert.equal(note, null);
  assert.equal(mem.notes().length, 0);
});
