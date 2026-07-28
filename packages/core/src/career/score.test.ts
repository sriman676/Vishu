import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAudit, scoreResume } from "./score.js";

const evaluation = {
  scores: {
    open_source: { score: 8, max: 10, evidence: "x" },
    self_projects: { score: 6, max: 10, evidence: "x" },
    production: { score: 5, max: 10, evidence: "x" },
    technical_skills: { score: 7, max: 10, evidence: "x" },
  },
  bonus_points: { total: 3, breakdown: "b" },
  deductions: { total: 2, reasons: "r" },
  key_strengths: ["Strong OSS"],
  areas_for_improvement: ["Add production impact", "Quantify results"],
};

test("parseAudit: totals categories + bonus - deductions, surfaces improvements", () => {
  const r = parseAudit(JSON.stringify(evaluation));
  assert.equal(r.ok, true);
  assert.equal(r.total, 8 + 6 + 5 + 7 + 3 - 2); // 27
  assert.match(r.summary, /score: 27\.0 \(categories 26\/40, \+3 bonus, -2 deductions\)/);
  assert.match(r.summary, /improve: Add production impact; Quantify results/);
  assert.deepEqual(r.areasForImprovement, ["Add production impact", "Quantify results"]);
});

test("parseAudit: surfaces the CLI {error}, and bad/empty input", () => {
  assert.equal(parseAudit('{"error":"OPENAI_API_KEY not set"}').ok, false);
  assert.match(parseAudit('{"error":"OPENAI_API_KEY not set"}').summary, /OPENAI_API_KEY/);
  assert.equal(parseAudit("").error, "empty");
  assert.equal(parseAudit("not json").error, "bad_json");
});

test("parseAudit: tolerates missing fields (zeros, no crash)", () => {
  const r = parseAudit('{"scores":{},"key_strengths":[],"areas_for_improvement":[]}');
  assert.equal(r.ok, true);
  assert.equal(r.total, 0);
});

test("scoreResume: degrades cleanly when hiring-agent dir is unset (no spawn)", async () => {
  assert.match(await scoreResume({ resumeMarkdown: "# Resume" }), /set VISHU_HIRING_AGENT_DIR/);
  assert.match(await scoreResume({ hiringDir: "/definitely/not/here", resumeMarkdown: "# Resume" }), /set VISHU_HIRING_AGENT_DIR/);
});
