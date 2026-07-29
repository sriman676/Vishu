import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageToDataUrl, mimeForImage } from "./vision.js";

test("mimeForImage: known extensions, case-insensitive, png default", () => {
  assert.equal(mimeForImage("a.PNG"), "image/png");
  assert.equal(mimeForImage("a.jpg"), "image/jpeg");
  assert.equal(mimeForImage("a.jpeg"), "image/jpeg");
  assert.equal(mimeForImage("a.webp"), "image/webp");
  assert.equal(mimeForImage("a.unknown"), "image/png");
});

test("imageToDataUrl: http and data URLs pass through unchanged", () => {
  assert.equal(imageToDataUrl("https://x/a.png"), "https://x/a.png");
  assert.equal(imageToDataUrl("data:image/png;base64,AAA"), "data:image/png;base64,AAA");
});

test("imageToDataUrl: local file → base64 data URL with the right mime", () => {
  const dir = mkdtempSync(join(tmpdir(), "vision-"));
  try {
    const p = join(dir, "pic.png");
    writeFileSync(p, Buffer.from([1, 2, 3]));
    assert.equal(imageToDataUrl(p), `data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
