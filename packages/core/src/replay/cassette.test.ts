import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ScriptedProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import { Cassette } from "./cassette.js";

const tmp = () => join(mkdtempSync(join(tmpdir(), "vishu-cassette-")), "cassette.json");
const req = { model: "m", messages: [{ role: "user" as const, content: "q" }], category: "test" };

test("record then replay returns the recorded response without calling the provider", async () => {
  const file = tmp();

  // Record: a one-shot provider answers once; we capture it.
  const rec = new Router([new ScriptedProvider([{ content: "real answer", finish: "stop" }])], undefined, new Cassette(file, "record"));
  assert.equal((await rec.chat(req)).content, "real answer");

  // Replay: provider would throw if hit; the cassette serves the recording instead.
  const boom = new ScriptedProvider([new Error("provider must not be called in replay")]);
  const play = new Router([boom], undefined, new Cassette(file, "replay"));
  assert.equal((await play.chat(req)).content, "real answer");
});

test("replay miss falls through to the provider; off mode never records", async () => {
  const file = tmp();

  // off: real call, nothing written.
  const off = new Router([new ScriptedProvider([{ content: "live", finish: "stop" }])], undefined, new Cassette(file, "off"));
  assert.equal((await off.chat(req)).content, "live");

  // replay with an empty cassette → miss → provider answers.
  const play = new Router([new ScriptedProvider([{ content: "fresh", finish: "stop" }])], undefined, new Cassette(file, "replay"));
  assert.equal((await play.chat(req)).content, "fresh");
});
