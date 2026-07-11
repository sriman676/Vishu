import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SkillIndex } from "./index.js";
import { auditCapabilities, GITHUB_CHECKS, neededCapabilities, planAcquisition } from "./acquire.js";

function indexWith(...skills: { name: string; description: string; cluster?: string }[]): SkillIndex {
  const dir = mkdtempSync(join(tmpdir(), "acq-skills-"));
  const index = new SkillIndex();
  for (const s of skills) {
    const path = join(dir, `${s.name}.md`);
    writeFileSync(path, `---\nname: ${s.name}\ndescription: ${s.description}\ncluster: ${s.cluster ?? "misc"}\n---\nbody`);
    index.add(path);
  }
  return index;
}

test("neededCapabilities: drops stopwords + short words, dedupes", () => {
  const caps = neededCapabilities("build a website that can scrape scrape reddit");
  assert.equal(caps.includes("build"), false); // stopword
  assert.equal(caps.includes("website"), false); // stopword
  assert.equal(caps.filter((c) => c === "scrape").length, 1); // deduped
  assert.deepEqual(caps.sort(), ["reddit", "scrape"]);
});

test("auditCapabilities: present via skill or tool, missing otherwise", () => {
  const index = indexWith({ name: "reddit-api", description: "pull posts from reddit" });
  const toolText = "browser: drive a headless browser  web_fetch: fetch a url";
  const audit = auditCapabilities("scrape reddit with a browser", index, toolText);

  assert.equal(audit.present.includes("reddit"), true); // matched the indexed skill
  assert.equal(audit.present.includes("browser"), true); // matched an installed tool
  assert.equal(audit.missing.includes("scrape"), true); // neither skill nor tool → gap
});

test("planAcquisition: one step per gap, GitHub install carries the required security checks", () => {
  const steps = planAcquisition(["scrape"]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0]!.capability, "scrape");
  assert.equal(steps[0]!.plan.length, 3); // skill → package → gated github
  assert.match(steps[0]!.plan[0]!, /SKILL\.md/);
  assert.deepEqual(steps[0]!.githubChecks, GITHUB_CHECKS);
  assert.equal(GITHUB_CHECKS.some((c) => /exfiltration/.test(c)), true);
  assert.equal(GITHUB_CHECKS.some((c) => /remote-exec/.test(c)), true);
});
