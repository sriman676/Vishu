import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AchievementStore } from "./achievements.js";

function store() {
  return new AchievementStore(join(mkdtempSync(join(tmpdir(), "ach-")), "achievements.json"));
}

test("add: timestamps, extracts #tags, ignores blanks and duplicates", () => {
  const s = store();
  const a = s.add("Shipped the payments service #backend #python", new Date("2026-07-28T10:00:00Z"));
  assert.ok(a);
  assert.equal(a.at, "2026-07-28T10:00:00.000Z");
  assert.deepEqual(a.tags, ["backend", "python"]);

  assert.equal(s.add("   "), null); // blank ignored
  assert.equal(s.add("Shipped the payments service #backend #python"), null); // dup ignored
  assert.equal(s.list().length, 1);
});

test("list: newest first, filterable by tag", () => {
  const s = store();
  s.add("Older win #frontend", new Date("2026-07-01T00:00:00Z"));
  s.add("Newer win #backend", new Date("2026-07-20T00:00:00Z"));
  const all = s.list();
  assert.equal(all[0].text, "Newer win #backend"); // newest first
  assert.deepEqual(s.list("frontend").map((a) => a.text), ["Older win #frontend"]);
  assert.equal(s.list("nope").length, 0);
});

test("persists across instances (atomic JSON file)", () => {
  const file = join(mkdtempSync(join(tmpdir(), "ach-")), "achievements.json");
  new AchievementStore(file).add("Led the migration #ops");
  const reopened = new AchievementStore(file);
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.list()[0].text, "Led the migration #ops");
});
