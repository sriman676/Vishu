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

test("factory: re-registering an existing name is rejected (no silent overwrite)", async () => {
  const f = new AgentFactory(registerBuiltins(new ToolRegistry()), skillIndex(), { ask: async () => true });
  await f.approveAndRegister(f.propose("dup", "search the web and summarize"));
  const again = await f.approveAndRegister(f.propose("dup", "draft and send a cold email"));
  assert.equal(again.registered, false);
  assert.match(again.reason ?? "", /already exists/);
  assert.equal(f.agents().length, 1, "the original agent is untouched");
});

test("factory: revoke removes an approved agent (gated) and persists the removal", async () => {
  const storePath = join(mkdtempSync(join(tmpdir(), "vishu-rev-")), "agents.json");
  const f = new AgentFactory(registerBuiltins(new ToolRegistry()), skillIndex(), { ask: async () => true, storePath });
  await f.approveAndRegister(f.propose("mailer", "draft and send a cold email"));
  assert.equal(f.agents().length, 1);

  const res = await f.revoke("mailer");
  assert.equal(res.removed, true);
  assert.equal(f.agents().length, 0, "no longer routable");
  // A fresh factory (restart) sees the persisted removal.
  const reborn = new AgentFactory(registerBuiltins(new ToolRegistry()), skillIndex(), { storePath });
  assert.equal(reborn.get("mailer"), undefined, "removal survived restart");
  // …and without an approver, revoke is denied (fail-closed).
  await reborn.approveAndRegister(reborn.propose("mailer", "draft and send a cold email")); // no ask → not registered
  const denied = new AgentFactory(registerBuiltins(new ToolRegistry()), skillIndex(), { storePath }); // no ask
  assert.equal((await denied.revoke("nope")).removed, false);
});

test("factory: grantTool fulfils a wishlist item, bounded by the ⊆-parent invariant", async () => {
  const parent = registerBuiltins(new ToolRegistry());
  parent.register({ name: "special_cap", description: "a distinctive parent tool", parameters: { type: "object", properties: {} }, async run() { return ""; } });
  const f = new AgentFactory(parent, skillIndex(), { ask: async () => true });
  await f.approveAndRegister(f.propose("mailer", "draft and send a cold email"));
  assert.deepEqual(f.get("mailer")?.wishlist, ["send_email"], "wishlist recorded on the registered agent");

  // A cap the system doesn't expose can't be granted — the capability doesn't exist yet.
  const bad = await f.grantTool("mailer", "send_email");
  assert.equal(bad.granted, false);
  assert.match(bad.reason ?? "", /not available/);

  // A tool the parent DOES expose is granted and lands in the agent's toolset.
  const ok = await f.grantTool("mailer", "special_cap");
  assert.equal(ok.granted, true);
  assert.ok((f.get("mailer")?.tools as string[]).includes("special_cap"), "granted tool is now usable");
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
