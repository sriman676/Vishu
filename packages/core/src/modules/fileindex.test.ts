import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { indexRoots, shouldIndex } from "./fileindex.js";

test("shouldIndex: text files yes; secrets + non-text no", () => {
  assert.equal(shouldIndex("notes.md", ".md"), true);
  assert.equal(shouldIndex("app.ts", ".ts"), true);
  assert.equal(shouldIndex(".env", ""), false); // hard-block
  assert.equal(shouldIndex("credentials.json", ".json"), false);
  assert.equal(shouldIndex("id_rsa", ""), false);
  assert.equal(shouldIndex("server.pem", ".pem"), false);
  assert.equal(shouldIndex("photo.png", ".png"), false); // non-text
});

test("indexRoots: indexes text content, skips secrets + node_modules, FTS-searchable", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-files-"));
  writeFileSync(join(dir, "readme.md"), "the quick brown fox jumps");
  writeFileSync(join(dir, ".env"), "SECRET_KEY=hunter2"); // must NOT be indexed
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "brown fox in deps"); // must be skipped

  const db = new DatabaseSync(":memory:");
  db.exec("CREATE VIRTUAL TABLE files_fts USING fts5(path UNINDEXED, body);");
  const n = indexRoots(db, [dir]);
  assert.equal(n, 1); // only readme.md

  const hits = db.prepare("SELECT path FROM files_fts WHERE files_fts MATCH ?").all('"brown" OR "fox"') as { path: string }[];
  assert.equal(hits.length, 1);
  assert.match(hits[0].path, /readme\.md$/);
  const secret = db.prepare("SELECT path FROM files_fts WHERE files_fts MATCH ?").all('"hunter2"') as unknown[];
  assert.equal(secret.length, 0); // secret never entered the index
});
