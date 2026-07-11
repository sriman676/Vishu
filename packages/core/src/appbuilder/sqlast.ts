import ts from "typescript";
import type { Finding } from "./security.js";

/** CF3c AST pass — the "proper fix" UPGRADES §10 names: tell an interpolated *value* (real SQL
 * injection) from structural/parameterized assembly (`' WHERE ' + where.join(' AND ')`, `'?,'.repeat(n)`)
 * that a line regex can't. JS/TS only (parsed with the TypeScript compiler, already a dep); other
 * languages keep the regex rule in `security.ts`. Never throws — an unparseable file yields no findings,
 * matching the scanner's "never crash the scan" contract. */

const JS_TS = /\.(?:c|m)?[jt]sx?$/i;
export function isJsTs(file: string): boolean {
  return JS_TS.test(file);
}

/** A concatenation/template that carries a real SQL *statement*, not English prose that happens to use
 * the words "select"/"from"/"where". Match only statement-shaped fragments: `SELECT <col-list> FROM
 * <table>`, `INSERT INTO <t>`, `UPDATE <t> ... SET`, `DELETE FROM <t>`, `WHERE <col> <op>`, or `VALUES(`.
 * The SELECT arm allows only column-ish chars between SELECT and FROM, so "select/radio → ... from the
 * list" (a prompt) does NOT match, while "SELECT id, date FROM applications" does. */
const SQL_SHAPE =
  /\bselect\s+[\w*.,()\s]{0,200}?\bfrom\s+["'`\w]|\binsert\s+into\s+["'`\w]|\bupdate\s+["'`\w][\s\S]{0,120}?\bset\b|\bdelete\s+from\s+["'`\w]|\bwhere\s+[\w.`"'[\]]+\s*(?:=|<|>|<=|>=|!=|<>|\blike\b)|\bvalues\s*\(/i;

/** Structural/coercion/escaping calls build SQL *shape* (clauses, placeholder lists) or safely quote a
 * value — they don't inline a raw value. `escape`/`escapeId`/`quote`/`format` are the standard
 * driver-side parameterization helpers (mysql, sqlstring, pg-format). */
const STRUCTURAL_CALLS = new Set([
  "join", "repeat", "map", "filter", "String", "Number",
  "escape", "escapeId", "quote", "format",
]);

function scriptKind(file: string): ts.ScriptKind {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX;
  if (/\.tsx?$/i.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function calleeName(call: ts.CallExpression): string {
  const e = call.expression;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isIdentifier(e)) return e.text;
  return "";
}

/** Is `node` a static string expression — a literal, or a concat/template of literals and other static
 * consts? Used to identify `const COLS = "id, name, …"` column-list fragments. */
function isStaticStringExpr(node: ts.Expression, consts: Set<string>): boolean {
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return true;
  if (ts.isParenthesizedExpression(node)) return isStaticStringExpr(node.expression, consts);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return isStaticStringExpr(node.left, consts) && isStaticStringExpr(node.right, consts);
  if (ts.isTemplateExpression(node)) return node.templateSpans.every((s) => isStaticStringExpr(s.expression, consts));
  if (ts.isIdentifier(node)) return consts.has(node.text);
  return false;
}

/** Names of `const`s bound to a static string — resolved so an interpolated `${COLS}` (a column-list
 * constant) reads as SQL *structure*, not an inlined value. Source-order so a const built from earlier
 * consts resolves; forward refs are (conservatively) treated as values. */
function collectStaticStringConsts(sf: ts.SourceFile): Set<string> {
  const consts = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && node.declarationList.flags & ts.NodeFlags.Const) {
      for (const d of node.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.initializer && isStaticStringExpr(d.initializer, consts)) consts.add(d.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return consts;
}

/** Is a dynamic operand "safe" — i.e. it contributes SQL structure or a coerced/parameterized part,
 * not an inlined value? Identifiers that resolve to a static-string const (column lists) are structure;
 * other identifiers, property/element access, and unknown calls are treated as values. */
function isSafeOperand(node: ts.Expression, consts: Set<string>): boolean {
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return true;
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isParenthesizedExpression(node)) return isSafeOperand(node.expression, consts);
  if (ts.isConditionalExpression(node)) return isSafeOperand(node.whenTrue, consts) && isSafeOperand(node.whenFalse, consts);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return isSafeOperand(node.left, consts) && isSafeOperand(node.right, consts);
  if (ts.isTemplateExpression(node)) return node.templateSpans.every((s) => isSafeOperand(s.expression, consts));
  if (ts.isCallExpression(node)) {
    if (STRUCTURAL_CALLS.has(calleeName(node))) return true;
    // A chained call on a safe receiver stays structural, e.g. `'?,'.repeat(n).slice(0, -1)`.
    const e = node.expression;
    return ts.isPropertyAccessExpression(e) && isSafeOperand(e.expression, consts);
  }
  if (ts.isIdentifier(node)) return consts.has(node.text); // a static-string const (column list) is structure
  // PropertyAccess / ElementAccess / anything else that yields a value → unsafe.
  return false;
}

/** Flatten a `+` chain (and any template it contains) into static text + dynamic operand nodes. */
function flatten(node: ts.Expression, statics: string[], dynamics: ts.Expression[]): void {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    flatten(node.left, statics, dynamics);
    flatten(node.right, statics, dynamics);
    return;
  }
  if (ts.isParenthesizedExpression(node)) {
    flatten(node.expression, statics, dynamics);
    return;
  }
  if (ts.isStringLiteralLike(node)) {
    statics.push(node.text);
    return;
  }
  if (ts.isTemplateExpression(node)) {
    statics.push(node.head.text);
    for (const span of node.templateSpans) {
      dynamics.push(span.expression);
      statics.push(span.literal.text);
    }
    return;
  }
  dynamics.push(node);
}

/** Is this concat/template the top of its chain (so we analyze each SQL expression exactly once)? */
function isChainRoot(node: ts.Expression): boolean {
  const p = node.parent;
  if (p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken) return false;
  if (p && ts.isParenthesizedExpression(p)) return isChainRoot(p);
  return true;
}

export function sqlAstFindings(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true, scriptKind(file));
  } catch {
    return findings; // unparseable — never crash the scan
  }

  const line = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const staticConsts = collectStaticStringConsts(sf);

  const visit = (node: ts.Node): void => {
    const isPlus =
      ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;
    const isTemplate = ts.isTemplateExpression(node);
    if ((isPlus || isTemplate) && isChainRoot(node as ts.Expression)) {
      const statics: string[] = [];
      const dynamics: ts.Expression[] = [];
      flatten(node as ts.Expression, statics, dynamics);
      if (dynamics.length > 0 && SQL_SHAPE.test(statics.join(" "))) {
        const unsafe = dynamics.some((d) => !isSafeOperand(d, staticConsts));
        findings.push({
          file,
          line: line(node),
          rule: "sql-injection",
          severity: unsafe ? "block" : "warn",
          message: unsafe
            ? "SQL interpolates a value — use parameterized queries (?/$1), not string interpolation"
            : "dynamic SQL assembled from structural/parameterized parts — verify values are bound, not inlined",
        });
        // Don't descend into an already-classified SQL expression (avoids double findings).
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}
