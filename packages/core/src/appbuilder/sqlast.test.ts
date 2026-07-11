import { strict as assert } from "node:assert";
import { test } from "node:test";
import { sqlAstFindings } from "./sqlast.js";

const sev = (file: string, text: string) => {
  const f = sqlAstFindings(file, text);
  return { block: f.some((x) => x.severity === "block"), warn: f.some((x) => x.severity === "warn"), n: f.length };
};

test("interpolated value in a SQL template literal → block", () => {
  const r = sev("q.ts", "const sql = `SELECT * FROM t WHERE id = ${userId}`;");
  assert.equal(r.block, true);
});

test("string-concatenated value into SQL → block", () => {
  const r = sev("q.mjs", 'const sql = "DELETE FROM t WHERE id=" + getId();');
  assert.equal(r.block, true); // unknown call yields a value
});

test("parameterized dynamic WHERE built with .join → warn, not block (the career-ops FP)", () => {
  const src = [
    "let sql = 'SELECT id, date FROM applications'",
    "  + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC';",
  ].join("\n");
  const r = sev("tracker.mjs", src);
  assert.equal(r.block, false);
  assert.equal(r.warn, true);
});

test("placeholder list built with .repeat → not a block", () => {
  const r = sev("q.mjs", "const sql = `SELECT * FROM t WHERE id IN (${'?,'.repeat(n).slice(0,-1)})`;");
  assert.equal(r.block, false);
});

test('English word "from" in a log template literal → no finding (not SQL)', () => {
  const r = sev("log.mjs", "console.log(`${total} applications (${range.from} to ${range.to})`);");
  assert.equal(r.n, 0);
});

test('LLM prompt template with prose "select/radio ... from the list" → no finding', () => {
  const src =
    "const prompt = `Fill the form (${title}). For each field:\\n" +
    "- select/radio → choose the best-matching option using the EXACT option text from the list.\\n" +
    "FIELDS:\\n${fieldsList}`;";
  const r = sev("route.ts", src);
  assert.equal(r.n, 0);
});

test("pure static SQL literal (no dynamics) → no finding", () => {
  const r = sev("q.ts", "const sql = `SELECT * FROM t WHERE active = 1`;");
  assert.equal(r.n, 0);
});

test("unparseable file → no crash, no findings", () => {
  const r = sev("broken.ts", "const sql = `SELECT ${{{{ ;");
  assert.equal(r.block, false);
});
