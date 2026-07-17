import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryStore } from "./store.js";

function mem(): MemoryStore {
  const dir = mkdtempSync(join(tmpdir(), "vishu-mem-"));
  return new MemoryStore(join(dir, "vault"), join(dir, "index.db"));
}

const DAY = 86_400_000;

test("ingest lane: unpromoted raw notes expire after the 7-day TTL; promoted ones survive (§11f)", async () => {
  const m = mem();
  const a = await m.ingest("raw signal one");
  const b = await m.ingest("raw signal two");
  m.promote(b.name); // lift b into working memory
  const { expired } = m.sweepTiers({ now: Date.now() + 8 * DAY }); // 8 days on, past the ingest TTL
  assert.deepEqual(expired, [a.name], "the unpromoted ingest note expired");
  assert.ok(m.notes().some((n) => n.name === b.name), "the promoted note survived the sweep");
  m.close();
});

test("tiering: working notes past the archive window move to the cold tier, kept on disk (§11f)", async () => {
  const m = mem();
  const n = await m.put({ content: "an old working fact" });
  const { archived } = m.sweepTiers({ now: Date.now() + 100 * DAY });
  assert.deepEqual(archived, [n.name]);
  assert.equal(m.notes().find((x) => x.name === n.name)?.folder, "cold", "demoted into the cold tier, not deleted");
  m.close();
});
