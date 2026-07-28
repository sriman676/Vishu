import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ScriptedProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import { makePolicy } from "../security/policy.js";
import { registerBuiltins } from "../tools/builtins.js";
import { ToolRegistry } from "../tools/registry.js";
import { Terminal } from "../tools/terminal.js";
import { DigitalTwin } from "../personalization/twin.js";
import { AgentService } from "./service.js";

function makeService(twin: DigitalTwin, nudges: string[]) {
  return new AgentService({
    router: new Router([new ScriptedProvider(Array(9).fill({ content: "ok", finish: "stop" }))]),
    tools: registerBuiltins(new ToolRegistry()),
    policy: makePolicy("full", mkdtempSync(join(tmpdir(), "vishu-act-"))),
    terminal: new Terminal(mkdtempSync(join(tmpdir(), "vishu-act-"))),
    model: "scripted",
    twin,
    recurringThreshold: 3,
    suggestTask: (task) => nudges.push(task),
  });
}

test("learned proactivity: a repeated task nudges exactly once, on the threshold turn", async () => {
  const twin = new DigitalTwin(join(mkdtempSync(join(tmpdir(), "twin-")), "twin.json"));
  const nudges: string[] = [];
  const svc = makeService(twin, nudges);

  await svc.startTurn(undefined, "summarise my unread email");
  assert.equal(nudges.length, 0); // count 1
  await svc.startTurn(undefined, "summarise my unread email");
  assert.equal(nudges.length, 0); // count 2
  await svc.startTurn(undefined, "summarise my unread email");
  assert.equal(nudges.length, 1); // count 3 -> fires
  assert.match(nudges[0], /unread email/);
  await svc.startTurn(undefined, "summarise my unread email");
  assert.equal(nudges.length, 1); // count 4 -> does NOT re-fire
});

test("learned proactivity: distinct one-off tasks never nudge", async () => {
  const twin = new DigitalTwin(join(mkdtempSync(join(tmpdir(), "twin-")), "twin.json"));
  const nudges: string[] = [];
  const svc = makeService(twin, nudges);

  await svc.startTurn(undefined, "book a flight to Tokyo");
  await svc.startTurn(undefined, "what's the weather");
  await svc.startTurn(undefined, "fix the failing test");
  assert.equal(nudges.length, 0);
});
