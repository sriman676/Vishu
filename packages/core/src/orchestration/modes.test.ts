import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MODES, ModeManager, proposeMode } from "./modes.js";

test("mode manager: starts in pa-master and lists the four predefined modes", () => {
  const m = new ModeManager();
  assert.equal(m.active().name, "pa-master");
  assert.deepEqual(m.list().map((x) => x.name).sort(), ["co-founder", "interviewer", "pa-master", "teacher"]);
});

test("activate: switches to an existing mode, refuses an unknown one", () => {
  const m = new ModeManager();
  assert.deepEqual(m.activate("teacher"), { activated: true });
  assert.equal(m.active().name, "teacher");
  const bad = m.activate("wizard");
  assert.equal(bad.activated, false);
  assert.match(bad.reason ?? "", /no mode named/);
  assert.equal(m.active().name, "teacher"); // unchanged
});

test("proposeMode: slugifies the name and templates the need into the prompt", () => {
  const mode = proposeMode("Sales Coach!", "close enterprise deals");
  assert.equal(mode.name, "sales-coach");
  assert.match(mode.system, /close enterprise deals/);
  assert.equal(mode.tools, "inherit");
  assert.equal(mode.memoryFolder, "sales-coach");
});

test("register: no ask wired denies (fail-closed) — no silent persona", async () => {
  const m = new ModeManager(); // no ask → gate denies
  const res = await m.register(proposeMode("rogue", "do anything"));
  assert.equal(res.registered, false);
  assert.equal(m.list().some((x) => x.name === "rogue"), false);
});

test("register: approved mode hot-loads, activates, and refuses to overwrite", async () => {
  const m = new ModeManager({ ask: async () => true });
  const res = await m.register(proposeMode("mentor", "guide a junior dev"), { activate: true });
  assert.deepEqual(res, { registered: true });
  assert.equal(m.active().name, "mentor"); // hot-loaded + activated, no restart
  const dup = await m.register(proposeMode("mentor", "again"));
  assert.equal(dup.registered, false); // no silent overwrite
  const predefined = await m.register(proposeMode("teacher", "x"));
  assert.equal(predefined.registered, false); // collides with a predefined mode
});

test("persist + load: a custom mode survives a restart, predefined ones are not duplicated", async () => {
  const store = join(mkdtempSync(join(tmpdir(), "modes-")), "modes.json");
  const m1 = new ModeManager({ ask: async () => true, storePath: store });
  await m1.register(proposeMode("negotiator", "haggle hard"));

  const m2 = new ModeManager({ ask: async () => true, storePath: store }); // fresh instance = restart
  assert.equal(m2.list().some((x) => x.name === "negotiator"), true);
  // only the one custom mode was persisted (predefined live in code, not the store)
  assert.equal(m2.list().length, Object.keys(MODES).length + 1);
});
