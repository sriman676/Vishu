import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { makeToolRunner, parseSpec, runDag, topoOrder } from "./dag.js";

test("topoOrder respects dependencies and rejects cycles / bad deps / dup ids", () => {
  const order = topoOrder([
    { id: "c", tool: "t", needs: ["a", "b"] },
    { id: "a", tool: "t" },
    { id: "b", tool: "t", needs: ["a"] },
  ]);
  assert.equal(order.indexOf("a") < order.indexOf("b"), true);
  assert.equal(order.indexOf("b") < order.indexOf("c"), true);

  assert.throws(() => topoOrder([{ id: "x", tool: "t", needs: ["y"] }]), /unknown node/);
  assert.throws(() => topoOrder([{ id: "x", tool: "t" }, { id: "x", tool: "t" }]), /duplicate/);
  assert.throws(
    () => topoOrder([{ id: "a", tool: "t", needs: ["b"] }, { id: "b", tool: "t", needs: ["a"] }]),
    /cycle/,
  );
});

test("parseSpec validates the untrusted shape", () => {
  assert.throws(() => parseSpec("{}"), /non-empty nodes/);
  assert.throws(() => parseSpec({ nodes: [{ id: "a" }] }), /string id and tool/);
  const s = parseSpec('{"nodes":[{"id":"a","tool":"echo"}]}');
  assert.equal(s.nodes[0]!.tool, "echo");
});

test("runDag threads upstream outputs into {{nodeId}} references", async () => {
  const spec = parseSpec({
    name: "greet",
    nodes: [
      { id: "who", tool: "const", args: { v: "world" } },
      { id: "hi", tool: "wrap", args: { text: "hello {{who}}" }, needs: ["who"] },
    ],
  });
  const calls: string[] = [];
  const res = await runDag(spec, async (tool, args) => {
    calls.push(tool);
    if (tool === "const") return String(args.v);
    return `[${args.text}]`;
  });
  assert.deepEqual(res.order, ["who", "hi"]);
  assert.equal(res.outputs.hi, "[hello world]");
});

test("makeToolRunner runs registered tools but refuses side-effecting + delegating nodes", async () => {
  const reg = new ToolRegistry();
  reg.register({ name: "note", description: "", parameters: { type: "object", properties: {} }, run: async () => "ok", meta: { action: "write" } });
  reg.register({ name: "pay", description: "", parameters: { type: "object", properties: {} }, run: async () => "paid", meta: { action: "spend" } });
  const ctx = { policy: {}, terminal: {} } as unknown as ToolContext;
  const runTool = makeToolRunner(reg, ctx);

  assert.equal(await runTool("note", {}), "ok");
  await assert.rejects(runTool("pay", {}), /spend-class/); // floor class blocked
  await assert.rejects(runTool("dispatch", {}), /no recursion\/fan-out/); // delegating tool blocked
});
