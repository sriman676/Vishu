import assert from "node:assert/strict";
import { test } from "node:test";
import { EchoProvider } from "../providers/mock.js";
import { Router } from "../providers/router.js";
import { autoFixPass } from "../automation/autofix.js";
import type { Validator } from "../reliability/verify.js";
import type { ProviderConfig } from "../config/config.js";
import { RoleRegistry, buildRoles } from "./roles.js";

test("role registry: dispatches to the assigned AI, falls back otherwise", () => {
  const fallback = new Router([new EchoProvider()]);
  const builder = new Router([new EchoProvider()]);
  const reg = new RoleRegistry(fallback).assign("builder", builder);

  assert.equal(reg.for("builder"), builder);
  assert.equal(reg.for("messenger"), fallback); // unassigned → fallback
  assert.deepEqual(reg.roles(), ["builder"]);
});

test("buildRoles: assigns configured providers and skips unknown ones", () => {
  const fallback = new Router([new EchoProvider()]);
  const providers: Record<string, ProviderConfig> = {
    fast: { type: "mock", model: "mock", baseUrl: "", apiKeys: [], keyLabels: [] },
  };
  const reg = buildRoles(fallback, providers, { builder: "fast", judge: "missing" });
  assert.deepEqual(reg.roles(), ["builder"]); // judge→missing was skipped
  assert.notEqual(reg.for("builder"), fallback); // a real dedicated router
  assert.equal(reg.for("judge"), fallback); // unknown provider → fallback
});

/** A validator that fails its first `failTimes` runs, then passes — stands in for a build/test command. */
function flakyValidator(failTimes: number): Validator & { runs: number } {
  const v = {
    name: "build",
    runs: 0,
    async run() {
      v.runs += 1;
      const ok = v.runs > failTimes;
      return { ok, output: ok ? "build ok" : "TypeError on line 3" };
    },
  };
  return v;
}

test("auto-fix: at automatic autonomy, a failing build is fixed within budget", async () => {
  const validator = flakyValidator(2); // fail, fail, then pass
  let fixes = 0;
  const r = await autoFixPass({ validator, fix: async () => void (fixes += 1), autonomy: "automatic" });
  assert.deepEqual({ ran: r.ran, ok: r.ok, attempts: r.attempts }, { ran: true, ok: true, attempts: 2 });
  assert.equal(fixes, 2);
});

test("auto-fix: non-automatic autonomy parks for approval instead of fixing", async () => {
  const validator = flakyValidator(1);
  let parked: string | undefined;
  let fixes = 0;
  const r = await autoFixPass({
    validator,
    fix: async () => void (fixes += 1),
    autonomy: "ask_every_time",
    onParked: (o) => (parked = o),
  });
  assert.deepEqual({ ran: r.ran, ok: r.ok }, { ran: false, ok: false });
  assert.equal(fixes, 0, "never auto-fixes without automatic autonomy");
  assert.match(parked ?? "", /TypeError/);
});

test("auto-fix: a green build does nothing", async () => {
  const r = await autoFixPass({ validator: flakyValidator(0), fix: async () => {}, autonomy: "automatic" });
  assert.deepEqual(r, { ran: false, ok: true, attempts: 0 });
});
