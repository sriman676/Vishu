import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SkillIndex } from "./index.js";
import { findBash, runSkill } from "./runtime.js";

function skillFile(dir: string, file: string, body: string): string {
  const path = join(dir, file);
  writeFileSync(path, body);
  return path;
}

test("3-tier disclosure: clusters, matched descriptors, body on demand; incremental add", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-skills-"));
  const index = new SkillIndex();
  index.add(skillFile(dir, "git.md", "---\nname: git-commit\ndescription: Make a clean git commit\ncluster: vcs\n---\nrun git commit"));
  index.add(skillFile(dir, "pdf.md", "---\nname: pdf-extract\ndescription: Extract text from a PDF\ncluster: docs\n---\nuse pdftotext"));

  assert.deepEqual(index.clusters(), ["docs", "vcs"]); // tier 1
  const hits = index.search("commit git"); // tier 2 — only matched one-liners
  assert.equal(hits[0]?.name, "git-commit");
  assert.ok(index.body("git-commit").includes("git commit")); // tier 3 — body loaded on demand

  // incremental: a new skill is searchable without reloading the others.
  index.add(skillFile(dir, "sql.md", "---\nname: sql-tune\ndescription: Optimize a slow SQL query\ncluster: db\n---\nEXPLAIN ANALYZE"));
  assert.equal(index.search("slow sql")[0]?.name, "sql-tune");
});

const bash = findBash();
test("a bash skill runs on Windows (via Git Bash)", { skip: !bash }, () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-bash-"));
  const path = join(dir, "hello.md");
  writeFileSync(path, "---\nname: hello\ndescription: say hi\nruntime: bash\n---\necho hello-from-skill");
  const result = runSkill(new SkillIndex().add(path), dir);
  assert.equal(result.code, 0);
  assert.match(result.out, /hello-from-skill/);
});
