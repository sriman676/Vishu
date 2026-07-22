import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyExecution, classifyLane, LANE_MODE, routeAndActivate } from "./lane.js";
import { ModeManager } from "./modes.js";

test("engineering requests route to the builder lane", () => {
  assert.equal(classifyLane("refactor the auth module and fix the failing tests"), "builder");
  assert.equal(classifyLane("build a Next.js app and deploy it"), "builder");
  assert.equal(classifyLane("debug this stack trace in the python script"), "builder");
});

test("PA/ops requests route to the brain lane", () => {
  assert.equal(classifyLane("draft an email to the recruiter and schedule a meeting"), "brain");
  assert.equal(classifyLane("find me a remote cybersecurity internship and apply"), "brain");
  assert.equal(classifyLane("summarize my calendar for tomorrow"), "brain");
});

test("empty / ambiguous falls back to the safe brain lane", () => {
  assert.equal(classifyLane(""), "brain");
  assert.equal(classifyLane("hello there"), "brain");
});

test("routeAndActivate flips the ModeManager into the lane's mode", () => {
  const modes = new ModeManager();
  const r = routeAndActivate(modes, "implement and ship the new feature");
  assert.equal(r.lane, "builder");
  assert.equal(r.mode, LANE_MODE.builder);
  assert.equal(modes.active().name, "co-founder");

  const r2 = routeAndActivate(modes, "read my email and remind me to reply");
  assert.equal(r2.lane, "brain");
  assert.equal(modes.active().name, "pa-master");
});

test("classifyExecution: private/cheap → local, hard reasoning → cloud", () => {
  assert.equal(classifyExecution("summarize my email thread"), "local");
  assert.equal(classifyExecution("classify these support tickets"), "local");
  assert.equal(classifyExecution("architect a distributed rate limiter and implement it"), "cloud");
  assert.equal(classifyExecution("write a haiku"), "cloud"); // no local signal → cloud default
});

test("classifyExecution: privacy-strict forces personal-data tasks local", () => {
  const strict = { JARVIS_PRIVACY_MODE: "strict" } as NodeJS.ProcessEnv;
  // this task is cloud-dominant by keywords (design+implement > 1 personal signal)…
  assert.equal(classifyExecution("design and implement an analyzer for my email", {} as NodeJS.ProcessEnv), "cloud");
  // …but under privacy-strict the personal-data signal forces it local, keeping the email off cloud prompts.
  assert.equal(classifyExecution("design and implement an analyzer for my email", strict), "local");
});
