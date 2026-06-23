import assert from "node:assert/strict";
import { test } from "node:test";
import { blockingFindings, semgrepScan } from "./sast.js";

// node stub standing in for the semgrep python sidecar: reads one request line, echoes findings.
const FIND_STUB = `let b="";process.stdin.on("data",d=>b+=d);process.stdin.on("end",()=>{const r=JSON.parse(b);process.stdout.write(JSON.stringify({findings:[{rule:"sqli",severity:"ERROR",path:r.path,line:7}]})+"\\n")});`;
const MISSING_STUB = `let b="";process.stdin.on("data",d=>b+=d);process.stdin.on("end",()=>{process.stdout.write(JSON.stringify({error:"semgrep not installed"})+"\\n")});`;

test("semgrep: returns findings via the sidecar; blockingFindings filters high severity", async () => {
  const res = await semgrepScan("app/", {}, { VISHU_SAST_CMD: JSON.stringify(["node", "-e", FIND_STUB]) } as never);
  assert.equal(res.available, true);
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0]!.rule, "sqli");
  assert.equal(blockingFindings(res.findings).length, 1);
});

test("semgrep: absent tool degrades to available:false, never a crash (deterministic scanner stays the gate)", async () => {
  const res = await semgrepScan("app/", {}, { VISHU_SAST_CMD: JSON.stringify(["node", "-e", MISSING_STUB]) } as never);
  assert.equal(res.available, false);
  assert.match(res.error ?? "", /not installed/);
});
