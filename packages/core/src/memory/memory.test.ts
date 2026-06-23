import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryStore } from "./store.js";

function paths() {
  const dir = mkdtempSync(join(tmpdir(), "vishu-mem-"));
  return { vault: join(dir, "vault"), db: join(dir, "memory.db") };
}

test("write a fact one session, recall it the next", () => {
  const { vault, db } = paths();
  let store = new MemoryStore(vault, db);
  store.put({ content: "The user's name is Vishnu.", subject: "user-name" });
  store.close();

  store = new MemoryStore(vault, db); // new session
  assert.match(store.recall("what is the user name").text, /Vishnu/);
  store.close();
});

test("edit a note in Obsidian → agent sees it on re-index", () => {
  const { vault, db } = paths();
  const store = new MemoryStore(vault, db);
  store.put({ content: "placeholder", subject: "seed" }); // creates the vault dir
  // simulate the user creating/editing a markdown note directly in Obsidian
  writeFileSync(
    join(vault, "editor-pref.md"),
    "---\ntype: fact\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\nThe user prefers the vim editor.\n",
  );
  assert.equal(store.recall("which editor").text, ""); // not indexed yet
  store.reindex();
  assert.match(store.recall("which editor").text, /vim/);
  store.close();
});

test("delete the SQLite index → rebuilds from markdown, no content loss", () => {
  const { vault, db } = paths();
  let store = new MemoryStore(vault, db);
  store.put({ content: "The user's name is Vishnu.", subject: "user-name" });
  store.close();

  rmSync(db); // nuke the derived index
  store = new MemoryStore(vault, db); // empty index + populated vault → self-heals on open
  assert.match(store.recall("user name").text, /Vishnu/);
  store.close();
});

test("contradiction on write supersedes the prior fact (newest wins)", () => {
  const { vault, db } = paths();
  const store = new MemoryStore(vault, db);
  store.put({ content: "The capital is Alpha.", subject: "capital" });
  store.put({ content: "The capital is Bravo.", subject: "capital" });
  const r = store.recall("capital");
  assert.match(r.text, /Bravo/);
  assert.doesNotMatch(r.text, /Alpha/);
  store.close();
});

test("smart-walk gathers a linked note recall alone would miss", () => {
  const { vault, db } = paths();
  const store = new MemoryStore(vault, db);
  store.put({ content: "Project Apollo is a web app. Lead is [[Jane Doe]].", subject: "project-apollo", type: "project" });
  store.put({ content: "Jane Doe is the tech lead.", subject: "jane-doe", type: "person" });
  const r = store.recall("apollo");
  assert.match(r.text, /tech lead/); // pulled in by walking the [[Jane Doe]] link
  assert.ok(r.notes.some((n) => n.via === "link"));
  store.close();
});
