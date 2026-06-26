import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AgentService } from "../agent/service.js";
import { EchoProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import { makePolicy } from "../security/policy.js";
import { Terminal } from "../tools/terminal.js";
import { ToolRegistry } from "../tools/registry.js";
import { IdentityProfile } from "./profile.js";
import { DigitalTwin } from "./twin.js";

test("profile: notes dedupe, persist across reloads, and render a prompt block", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-profile-"));
  const file = join(dir, "profile.json");
  try {
    const p = new IdentityProfile(file);
    assert.equal(p.note("prefers TypeScript"), true);
    assert.equal(p.note("prefers TypeScript"), false); // duplicate
    assert.equal(p.note("  "), false); // empty
    assert.equal(new IdentityProfile(file).render(), "What you know about this user:\n- prefers TypeScript"); // survived reload
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("profile: absorbs the twin's recurring tasks; empty profile renders nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-profile-"));
  try {
    const twin = new DigitalTwin(join(dir, "twin.json"));
    for (let i = 0; i < 3; i++) twin.record("ship the release notes");
    const p = new IdentityProfile(join(dir, "profile.json"));
    assert.equal(p.render(), ""); // fresh profile adds no noise
    assert.equal(p.absorbTwin(twin, 3), 1);
    assert.match(p.render(), /Often asks: ship the release notes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agent: the identity profile loads into a new session's system prompt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-profile-"));
  try {
    const profile = new IdentityProfile(join(dir, "profile.json"));
    profile.note("calls me by my first name");
    const svc = new AgentService({
      router: new Router([new EchoProvider()]),
      tools: new ToolRegistry(),
      policy: makePolicy("full", dir),
      terminal: new Terminal(dir),
      model: "mock",
      profile,
    });
    const { sessionId } = await svc.startTurn(undefined, "hi");
    const system = svc.transcript(sessionId)[0];
    assert.equal(system?.role, "system");
    assert.match(system!.content, /calls me by my first name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
