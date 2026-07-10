import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SkillIndex } from "../skills/index.js";
import { registerBuiltins } from "../tools/builtins.js";
import { ToolRegistry } from "../tools/registry.js";
import { AgentFactory } from "./factory.js";

/** A SkillIndex with two on-disk SKILL.md descriptors, for the cited-skills report. */
function skillIndex(): SkillIndex {
  const dir = mkdtempSync(join(tmpdir(), "vishu-skills-"));
  writeFileSync(join(dir, "outreach.md"), "---\nname: email-outreach\ndescription: draft and send cold emails to contacts\ncluster: outreach\n---\nbody");
  writeFileSync(join(dir, "research.md"), "---\nname: web-research\ndescription: search the web and summarize findings\ncluster: research\n---\nbody");
  const idx = new SkillIndex();
  idx.loadDir(dir);
  return idx;
}

test("factory.propose: cites skills, tools ⊆ parent, wishlist records missing caps", () => {
  const parent = registerBuiltins(new ToolRegistry());
  const parentNames = new Set(parent.schemas().map((s) => s.name));
  const f = new AgentFactory(parent, skillIndex());

  const p = f.propose("mailer", "draft and send a cold email to a contact");
  assert.ok(p.citedSkills.some((s) => s.name === "email-outreach"), "cites the relevant skill");
  assert.match(p.system, /email-outreach/, "prompt quotes the cited skill");
  assert.match(p.system, /Do NOT orchestrate or spawn other agents/, "forbids agent-to-agent chaining");
  assert.ok(p.tools.every((t) => parentNames.has(t)), "tools ⊆ parent (least privilege)");
  assert.deepEqual(p.toolWishlist, ["send_email"], "missing send capability recorded, not granted");
  assert.ok(!p.tools.includes("send_email"), "wishlist cap is NOT silently added to the toolset");
});

test("factory: registration is gated — no ask wired means no agent is created (no silent chaining)", async () => {
  const f = new AgentFactory(registerBuiltins(new ToolRegistry()), skillIndex()); // no ask → fail-closed
  const p = f.propose("mailer", "draft and send a cold email");
  assert.equal(f.agents().length, 0, "a proposal is inert until approved");
  const res = await f.approveAndRegister(p);
  assert.equal(res.registered, false, "denied without an approver");
  assert.equal(f.agents().length, 0, "still no agent registered");
});

test("factory: approved agent is live immediately (hot) without restart", async () => {
  const f = new AgentFactory(registerBuiltins(new ToolRegistry()), skillIndex(), { ask: async () => true });
  const res = await f.approveAndRegister(f.propose("researcher-x", "search the web and summarize"));
  assert.equal(res.registered, true);
  assert.equal(f.agents().length, 1);
  assert.equal(f.get("researcher-x")?.name, "researcher-x", "runnable at once, no reload");
});

test("factory: approved agents persist across a restart via the store path", async () => {
  const storePath = join(mkdtempSync(join(tmpdir(), "vishu-factory-")), "agents.json");
  const parent = registerBuiltins(new ToolRegistry());
  const first = new AgentFactory(parent, skillIndex(), { ask: async () => true, storePath });
  await first.approveAndRegister(first.propose("persisted", "search the web and summarize"));

  // A fresh factory (simulating a restart) loads the persisted agent from the store.
  const reborn = new AgentFactory(parent, skillIndex(), { storePath });
  assert.equal(reborn.get("persisted")?.name, "persisted", "survives restart");
});
