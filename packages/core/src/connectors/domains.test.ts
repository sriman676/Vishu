import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ToolRegistry } from "../tools/registry.js";
import { DomainManager, loadDomains } from "./domains.js";

/** A minimal stdio MCP server named "careerops" exposing one `add` tool. */
const STUB = `
let buf="";process.stdin.setEncoding("utf8");
process.stdin.on("data",d=>{buf+=d;let i;while((i=buf.indexOf("\\n"))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!l)continue;const m=JSON.parse(l);
if(m.method==="initialize")r(m.id,{protocolVersion:"2024-11-05",capabilities:{},serverInfo:{name:"careerops",version:"0"}});
else if(m.method==="tools/list")r(m.id,{tools:[{name:"add",inputSchema:{type:"object",properties:{a:{type:"number"},b:{type:"number"}}}}]});
else if(m.method==="tools/call")r(m.id,{content:[{type:"text",text:String(m.params.arguments.a+m.params.arguments.b)}]});
else if(m.id!==undefined)r(m.id,{});}});
function r(id,result){process.stdout.write(JSON.stringify({jsonrpc:"2.0",id,result})+"\\n");}
`;

function stub(): string {
  const script = join(mkdtempSync(join(tmpdir(), "vishu-dom-")), "srv.mjs");
  writeFileSync(script, STUB);
  return script;
}

test("DomainManager: a domain's tools register namespaced with its configured action class", async () => {
  const registry = new ToolRegistry();
  const dm = new DomainManager(
    [{ id: "careerops", cmd: process.execPath, args: [stub()], reconnect: false, actions: { add: "send", "*": "read" } }],
    registry,
  );
  try {
    const names = await dm.start();
    assert.deepEqual(names, ["careerops__add"]); // namespaced under the domain id
    assert.equal(registry.getAction("careerops__add"), "send"); // per-tool action reaches the F0 gate
    assert.equal(await registry.get("careerops__add").run({ a: 2, b: 3 }, {} as never), "5"); // callable through the registry
  } finally {
    dm.stop();
  }
});

test('DomainManager: the "*" action is the default for tools not explicitly listed', async () => {
  const registry = new ToolRegistry();
  const dm = new DomainManager(
    [{ id: "careerops", cmd: process.execPath, args: [stub()], reconnect: false, actions: { "*": "delete" } }],
    registry,
  );
  try {
    await dm.start();
    assert.equal(registry.getAction("careerops__add"), "delete"); // falls back to the "*" default
  } finally {
    dm.stop();
  }
});

test("loadDomains: parses the domains array, returns [] when the file is missing/invalid", () => {
  const dir = mkdtempSync(join(tmpdir(), "vishu-dl-"));
  const f = join(dir, "jarvis.domains.json");
  writeFileSync(f, JSON.stringify({ domains: [{ id: "careerops", cmd: "python", args: ["-m", "x"] }] }));
  const loaded = loadDomains(f);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.id, "careerops");
  assert.deepEqual(loadDomains(join(dir, "nope.json")), []); // missing file → no domains, no throw
});
