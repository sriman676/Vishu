import assert from "node:assert/strict";
import { test } from "node:test";
import { searchFreeForDev } from "./reach.js";

const SAMPLE = [
  "* [Appinvento](https://appinvento.io/) - A free no-code app builder with unlimited APIs.",
  "* [DhiWise](https://www.dhiwise.com/) - Converts Figma designs into Flutter and React apps.",
  "## A heading, not a bullet",
  "* [Karbon Sites](https://karbonsites.space) - AI site builder, 5 free generations per month.",
].join("\n");

test("searchFreeForDev: parses bullets, matches name+desc, honors empty query and limit", () => {
  assert.deepEqual(searchFreeForDev(SAMPLE, ""), []);
  const figma = searchFreeForDev(SAMPLE, "figma");
  assert.equal(figma.length, 1);
  assert.match(figma[0], /^DhiWise — .*dhiwise\.com/);
  assert.equal(searchFreeForDev(SAMPLE, "no-code").length, 1); // Appinvento only
  assert.equal(searchFreeForDev(SAMPLE, "builder").length, 2); // Appinvento + Karbon
  assert.equal(searchFreeForDev(SAMPLE, "builder", 1).length, 1); // limit respected
  assert.equal(searchFreeForDev(SAMPLE, "zzznomatch").length, 0);
});
