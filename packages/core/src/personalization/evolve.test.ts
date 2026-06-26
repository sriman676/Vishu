import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WorkflowStore } from "../automation/workflows.js";
import { Registry } from "../transport/rpc.js";
import { registerEvolve } from "./rpc.js";
import { ProjectEvolver, analyzeProject, runEvolutionPass } from "./evolve.js";

/** Build a throwaway project tree to scan. */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "vishu-evolve-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "big.ts"), "const x = 1;\n".repeat(450)); // > 400 LOC
  writeFileSync(join(src, "notes.ts"), "// TODO: clean this up\nexport const y = 2;\n");
  writeFileSync(join(src, "ok.ts"), "export const z = 3;\n");
  return root;
}

test("analyzeProject flags oversized files, TODO markers, and missing tests", () => {
  const root = makeProject();
  try {
    const sigs = analyzeProject(root).map((p) => p.sig).sort();
    assert.deepEqual(sigs, ["split:src/big.ts", "tests:project", "todo:src/notes.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evolver: suggest-only with a human accept/dismiss gate; re-scans never duplicate", () => {
  const root = makeProject();
  try {
    const evolver = new ProjectEvolver(join(root, ".vishu", "evolve.json"));
    const workflows = new WorkflowStore(join(root, ".vishu", "workflows"));

    const first = evolver.propose(root);
    assert.equal(first.length, 3, "three opportunities found on first pass");
    assert.equal(evolver.propose(root).length, 0, "second pass adds nothing new (deduped by sig)");

    // Human gate: accept one (saved as a runnable workflow, never auto-applied), dismiss another.
    const accepted = evolver.accept("tests:project", workflows);
    assert.equal(accepted?.status, "accepted");
    assert.ok(workflows.get("improve: project"), "accepted proposal becomes a saved workflow");
    evolver.dismiss("todo:src/notes.ts");

    assert.deepEqual(evolver.pending().map((p) => p.sig), ["split:src/big.ts"]);
    // Decisions stick across a fresh scan: a dismissed sig is not re-proposed.
    assert.equal(evolver.propose(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evolve RPC: lists pending proposals and gates accept/dismiss decisions", async () => {
  const root = makeProject();
  try {
    const evolver = new ProjectEvolver(join(root, ".vishu", "evolve.json"));
    const workflows = new WorkflowStore(join(root, ".vishu", "workflows"));
    evolver.propose(root);
    const reg = new Registry();
    registerEvolve(reg, evolver, workflows);
    const call = async (method: string, params?: unknown) =>
      (await reg.handle({ jsonrpc: "2.0", id: 1, method, params })).result;

    const pending = (await call("vishu.evolve_proposals")) as { ok: true; result: unknown[] };
    assert.equal(pending.result.length, 3);

    assert.equal(((await call("vishu.evolve_decide", { sig: "x" })) as { ok: boolean }).ok, false); // bad decision
    const accepted = (await call("vishu.evolve_decide", { sig: "tests:project", decision: "accept" })) as { ok: boolean };
    assert.equal(accepted.ok, true);
    assert.ok(workflows.get("improve: project"));
    const missing = (await call("vishu.evolve_decide", { sig: "nope", decision: "dismiss" })) as { ok: boolean };
    assert.equal(missing.ok, false); // unknown sig
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evolver: decisions persist across reload; runEvolutionPass notifies on new proposals", () => {
  const root = makeProject();
  const file = join(root, ".vishu", "evolve.json");
  try {
    const events: unknown[] = [];
    const bus = { publish: (e: unknown) => events.push(e) } as any;

    const added = runEvolutionPass(new ProjectEvolver(file), root, bus);
    assert.equal(added.length, 3);
    assert.equal(events.length, 1, "one notification for the new proposals");

    // A fresh evolver reads the persisted store: nothing new, no notification.
    const events2: unknown[] = [];
    const bus2 = { publish: (e: unknown) => events2.push(e) } as any;
    assert.equal(runEvolutionPass(new ProjectEvolver(file), root, bus2).length, 0);
    assert.equal(events2.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
