import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isPaused, pause, pauseReason, pauseTools, resume } from "./pause.js";

function tmpFlag(): string {
  return join(mkdtempSync(join(tmpdir(), "vishu-pause-")), "PAUSED");
}

test("pause/isPaused/resume round-trips through the flag file", () => {
  const f = tmpFlag();
  try {
    assert.equal(isPaused(f), false);
    pause("runaway loop", f);
    assert.equal(isPaused(f), true);
    assert.match(pauseReason(f), /runaway loop/);
    resume(f);
    assert.equal(isPaused(f), false);
    resume(f); // idempotent: resuming when not paused is a no-op
  } finally {
    rmSync(f, { force: true });
  }
});

test("pause flag is a real file → survives a process restart (state is on disk, not in memory)", () => {
  const f = tmpFlag();
  try {
    pause("", f);
    assert.ok(existsSync(f)); // a fresh process reading this path sees paused=true
  } finally {
    rmSync(f, { force: true });
  }
});

test("jarvis_pause is a read-class safety control; jarvis_resume is change_setting", () => {
  const byName = Object.fromEntries(pauseTools.map((t) => [t.name, t]));
  assert.equal(byName.jarvis_pause?.meta?.action, "read"); // never gated → instant
  assert.equal(byName.jarvis_resume?.meta?.action, "change_setting"); // gated → confirmed
});
