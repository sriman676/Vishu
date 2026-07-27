import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryStore } from "./store.js";

function store() {
  const dir = mkdtempSync(join(tmpdir(), "vishu-todo-"));
  return new MemoryStore(join(dir, "vault"), join(dir, "memory.db"));
}

test("setTodo flips a checkbox line in place and persists", async () => {
  const s = store();
  const note = await s.put({ type: "todo", subject: "tasks", content: "- [ ] buy milk\n- [ ] call bank" });

  const updated = s.setTodo(note.name, "buy milk", true);
  assert.ok(updated);
  assert.equal(updated.name, note.name); // identity preserved (same note, not a new one)
  assert.match(updated.body, /- \[x\] buy milk/);
  assert.match(updated.body, /- \[ \] call bank/); // the other line untouched

  // survives a re-open (written to the vault, not just memory)
  const back = s.setTodo(note.name, "buy milk", false);
  assert.match(back!.body, /- \[ \] buy milk/);
  s.close();
});

test("setTodo returns undefined for a missing note or line", async () => {
  const s = store();
  const note = await s.put({ type: "todo", subject: "tasks", content: "- [ ] buy milk" });
  assert.equal(s.setTodo("no-such-note", "buy milk", true), undefined);
  assert.equal(s.setTodo(note.name, "not a real line", true), undefined);
  s.close();
});
