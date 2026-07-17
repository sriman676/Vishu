import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { folderSource, gmailSource, type PollSource, sourceEnabled, sourceInterval, startSync, type SyncItem } from "./sync.js";

test("sync env knobs: opt-out toggle + per-source / global / default interval", () => {
  assert.equal(sourceEnabled("gmail", {} as never), true); // on by default
  assert.equal(sourceEnabled("gmail", { VISHU_SYNC_GMAIL: "off" } as never), false);
  assert.equal(sourceInterval("gmail", { VISHU_SYNC_GMAIL_MS: "5000" } as never), 5000);
  assert.equal(sourceInterval("gmail", { VISHU_SYNC_MS: "7000" } as never), 7000); // global fallback
  assert.equal(sourceInterval("gmail", {} as never), 120_000); // default
});

test("gmailSource: auto-disabled without GMAIL_USER + GMAIL_APP_PASSWORD", () => {
  assert.equal(gmailSource({} as never).enabled?.({} as never), false);
  assert.equal(gmailSource({} as never).enabled?.({ GMAIL_USER: "a", GMAIL_APP_PASSWORD: "b" } as never), true);
});

test("folderSource: returns new files, skips already-seen ids and non-files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-folder-"));
  writeFileSync(join(dir, "a.txt"), "hello");
  writeFileSync(join(dir, "b.txt"), "world");
  mkdirSync(join(dir, "sub")); // a directory must be skipped, not filed
  const src = folderSource({ VISHU_SYNC_FOLDER: dir } as never);
  const first = await src.poll(new Set());
  assert.deepEqual(first.map((i) => i.id).sort(), ["a.txt", "b.txt"]);
  const second = await src.poll(new Set(["a.txt"])); // a.txt already seen
  assert.deepEqual(second.map((i) => i.id), ["b.txt"]);
});

test("startSync: a source's new items are filed through the pipeline; dedup + stop() work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-sync-"));
  const filed: SyncItem[] = [];
  let resolve!: () => void;
  const once = new Promise<void>((r) => (resolve = r));
  const src: PollSource = {
    name: "fake",
    poll: async (seen) => (seen.has("x") ? [] : [{ id: "x", channel: "t", from: "f", text: "hi" }]),
  };
  const stop = startSync({ bus: { publish() {} } } as never, [src], {
    seenDir: dir,
    env: { VISHU_SYNC_FAKE_MS: "60000" } as never, // long interval: only the immediate first tick fires
    file: async (_d, it) => {
      filed.push(it);
      resolve();
    },
  });
  await once;
  stop();
  assert.equal(filed.length, 1);
  assert.equal(filed[0].id, "x");
});

test("startSync: a disabled source never polls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-sync-off-"));
  let polled = false;
  const src: PollSource = {
    name: "fake",
    poll: async () => {
      polled = true;
      return [];
    },
  };
  const stop = startSync({ bus: { publish() {} } } as never, [src], { seenDir: dir, env: { VISHU_SYNC_FAKE: "off" } as never });
  stop();
  assert.equal(polled, false);
});
