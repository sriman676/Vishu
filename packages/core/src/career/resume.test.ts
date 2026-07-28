import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGithubProjects, assembleResumeMarkdown } from "./resume.js";

test("parseGithubProjects: bare array, sorted by stars, mapped fields", () => {
  const raw = [
    { name: "small", stargazers_count: 2, language: "TS", html_url: "u1", description: "d1" },
    { full_name: "me/big", stars: 50, language: "Go", url: "u2" },
    { description: "no name — dropped" },
  ];
  const p = parseGithubProjects(raw);
  assert.equal(p.length, 2);
  assert.equal(p[0].name, "me/big"); // higher stars first
  assert.equal(p[0].url, "u2");
  assert.equal(p[1].name, "small");
  assert.equal(p[1].description, "d1");
});

test("parseGithubProjects: {items} wrapper, JSON string, and garbage", () => {
  assert.equal(parseGithubProjects({ items: [{ name: "x" }] }).length, 1);
  assert.equal(parseGithubProjects('[{"name":"y"}]').length, 1);
  assert.deepEqual(parseGithubProjects("not json"), []);
  assert.deepEqual(parseGithubProjects(42), []);
});

test("parseGithubProjects: respects the limit", () => {
  const raw = Array.from({ length: 20 }, (_, i) => ({ name: `r${i}`, stars: i }));
  assert.equal(parseGithubProjects(raw, 5).length, 5);
});

test("assembleResumeMarkdown: composes sections, omits empty ones", () => {
  const md = assembleResumeMarkdown({
    profile: "Backend engineer.",
    achievements: [{ text: "Shipped payments", at: "2026-07-28T00:00:00Z" }],
    projects: [{ name: "vishu", url: "https://x", language: "TS", stars: 3, description: "a PA" }],
  });
  assert.match(md, /## Summary\n\nBackend engineer\./);
  assert.match(md, /## Projects/);
  assert.match(md, /\[vishu\]\(https:\/\/x\).*TS · ★3.*a PA/);
  assert.match(md, /## Achievements\n\n- 2026-07-28 — Shipped payments/);

  const sparse = assembleResumeMarkdown({ profile: "Just me." });
  assert.doesNotMatch(sparse, /## Projects|## Achievements/); // empty sections omitted
});
