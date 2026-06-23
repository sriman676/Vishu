import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EchoProvider } from "../providers/mock.js";
import { rollupSession } from "./rollup.js";
import { MemoryStore } from "./store.js";

function paths() {
  const dir = mkdtempSync(join(tmpdir(), "vishu-mem-"));
  return { vault: join(dir, "vault"), db: join(dir, "memory.db") };
}

test("write a fact one session, recall it the next", async () => {
  const { vault, db } = paths();
  let store = new MemoryStore(vault, db);
  await store.put({ content: "The user's name is Vishnu.", subject: "user-name" });
  store.close();

  store = new MemoryStore(vault, db); // new session
  assert.match((await store.recall("what is the user name")).text, /Vishnu/);
  store.close();
});

test("edit a note in Obsidian → agent sees it on re-index", async () => {
  const { vault, db } = paths();
  const store = new MemoryStore(vault, db);
  await store.put({ content: "placeholder", subject: "seed" }); // creates the vault dir
  // simulate the user creating/editing a markdown note directly in Obsidian
  writeFileSync(
    join(vault, "editor-pref.md"),
    "---\ntype: fact\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\nThe user prefers the vim editor.\n",
  );
  assert.equal((await store.recall("which editor")).text, ""); // not indexed yet
  store.reindex();
  assert.match((await store.recall("which editor")).text, /vim/);
  store.close();
});

test("delete the SQLite index → rebuilds from markdown, no content loss", async () => {
  const { vault, db } = paths();
  let store = new MemoryStore(vault, db);
  await store.put({ content: "The user's name is Vishnu.", subject: "user-name" });
  store.close();

  rmSync(db); // nuke the derived index
  store = new MemoryStore(vault, db); // empty index + populated vault → self-heals on open
  assert.match((await store.recall("user name")).text, /Vishnu/);
  store.close();
});

test("contradiction on write supersedes the prior fact (newest wins)", async () => {
  const { vault, db } = paths();
  const store = new MemoryStore(vault, db);
  await store.put({ content: "The capital is Alpha.", subject: "capital" });
  await store.put({ content: "The capital is Bravo.", subject: "capital" });
  const r = await store.recall("capital");
  assert.match(r.text, /Bravo/);
  assert.doesNotMatch(r.text, /Alpha/);
  store.close();
});

test("smart-walk gathers a linked note recall alone would miss", async () => {
  const { vault, db } = paths();
  const store = new MemoryStore(vault, db);
  await store.put({ content: "Project Apollo is a web app. Lead is [[Jane Doe]].", subject: "project-apollo", type: "project" });
  await store.put({ content: "Jane Doe is the tech lead.", subject: "jane-doe", type: "person" });
  const r = await store.recall("apollo");
  assert.match(r.text, /tech lead/); // pulled in by walking the [[Jane Doe]] link
  assert.ok(r.notes.some((n) => n.via === "link"));
  store.close();
});

test("semantic recall: an embedder stores vectors and recall still finds the fact", async () => {
  const { vault, db } = paths();
  const embed = new EchoProvider();
  const store = new MemoryStore(vault, db, undefined, (texts) => embed.embed(texts));
  await store.put({ content: "The deploy token lives in the OS keychain.", subject: "deploy-token" });
  // vectors were written, and recall (FTS + semantic blend) still returns the fact.
  assert.match((await store.recall("where is the deploy token kept")).text, /keychain/);
  store.close();
});

test("confidence decay: a fresh fact outranks a near-identical stale one", async () => {
  const { vault, db } = paths();
  const store = new MemoryStore(vault, db);
  // Old note written directly with a year-old timestamp; new note via put (now).
  writeFileSync(
    join(vault, "old.md"),
    "---\ntype: fact\nsubject: status\ncreated: 2025-01-01T00:00:00Z\nupdated: 2025-01-01T00:00:00Z\n---\nThe status report is stale data.\n",
  );
  const store2 = store; // same store, reindex picks up the file
  store2.reindex();
  await store2.put({ content: "The status report is fresh data.", subject: "status-new" });
  const r = await store2.recall("status report data");
  assert.equal(r.notes[0]?.body.includes("fresh"), true); // newer wins on near-tie
  store.close();
});

test("memory-tree rollup: condenses current notes into one linked summary note, excluding prior rollups", async () => {
  const { vault, db } = paths();
  const store = new MemoryStore(vault, db);
  await store.put({ content: "Apollo is a web app. It uses Postgres.", subject: "apollo", type: "project" });
  await store.put({ content: "Jane is the tech lead. She owns auth.", subject: "jane", type: "person" });
  const note = await rollupSession(store);

  assert.equal(note.type, "rollup");
  assert.match(note.body, /apollo/); // one line per note...
  assert.match(note.body, /jane/);
  assert.ok(note.links.includes("apollo") && note.links.includes("jane")); // ...linked into the graph

  // a second rollup excludes the first (no rollup-of-rollups bloat).
  const second = await rollupSession(store);
  assert.doesNotMatch(second.body, /session-rollup/);
  store.close();
});
