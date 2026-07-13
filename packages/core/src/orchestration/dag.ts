import { NEVER_WITHOUT_ASKING } from "../security/actions.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";

/** One DAG node: run `tool` with `args`, after every node in `needs` has produced output.
 * A string arg may reference an upstream node's output with `{{nodeId}}`. */
export interface DagNode {
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  needs?: string[];
}

/** A declarative workflow: a named DAG of tool nodes. Modes compose as nodes calling a mode-switch tool. */
export interface WorkflowSpec {
  name: string;
  nodes: DagNode[];
}

export interface DagRunResult {
  order: string[];
  outputs: Record<string, string>;
}

/** Parse + validate an untrusted spec (string or object). Throws typed errors at this trust boundary. */
export function parseSpec(input: unknown): WorkflowSpec {
  const spec = typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  if (!spec || typeof spec !== "object") throw new Error("workflow spec must be an object");
  const s = spec as Partial<WorkflowSpec>;
  if (!Array.isArray(s.nodes) || s.nodes.length === 0) throw new Error("workflow spec needs a non-empty nodes array");
  for (const n of s.nodes) {
    if (!n || typeof n.id !== "string" || typeof n.tool !== "string") throw new Error("each node needs a string id and tool");
    if (n.needs && !Array.isArray(n.needs)) throw new Error(`node ${n.id}: needs must be an array`);
  }
  return { name: typeof s.name === "string" ? s.name : "workflow", nodes: s.nodes as DagNode[] };
}

/** Kahn topological order; throws on a duplicate id, an unknown dependency, or a cycle. */
export function topoOrder(nodes: DagNode[]): string[] {
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) throw new Error(`duplicate node id: ${n.id}`);
    ids.add(n.id);
  }
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const n of nodes) {
    for (const dep of n.needs ?? []) {
      if (!ids.has(dep)) throw new Error(`node ${n.id} needs unknown node: ${dep}`);
      adj.get(dep)!.push(n.id);
      indeg.set(n.id, indeg.get(n.id)! + 1);
    }
  }
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id); // node order → deterministic
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const nxt of adj.get(id)!) {
      indeg.set(nxt, indeg.get(nxt)! - 1);
      if (indeg.get(nxt) === 0) queue.push(nxt);
    }
  }
  if (order.length !== nodes.length) throw new Error("workflow has a cycle");
  return order;
}

/** Deep-substitute `{{nodeId}}` tokens in string values with the referenced node's output. */
function substitute(value: unknown, outputs: Record<string, string>): unknown {
  if (typeof value === "string") return value.replace(/\{\{(\w+)\}\}/g, (_m, id) => outputs[id] ?? "");
  if (Array.isArray(value)) return value.map((v) => substitute(v, outputs));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, outputs);
    return out;
  }
  return value;
}

/** Run the DAG in topological order, threading each node's output forward. Sequential — a node runs
 * only after its deps. ponytail: sequential topo; parallelize independent siblings if latency matters. */
export async function runDag(
  spec: WorkflowSpec,
  runTool: (tool: string, args: Record<string, unknown>) => Promise<string>,
): Promise<DagRunResult> {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const order = topoOrder(spec.nodes);
  const outputs: Record<string, string> = {};
  for (const id of order) {
    const node = byId.get(id)!;
    const args = substitute(node.args ?? {}, outputs) as Record<string, unknown>;
    outputs[id] = await runTool(node.tool, args);
  }
  return { order, outputs };
}

// Delegating/self tools are refused inside a workflow so a spec can't fan out or recurse unbounded.
const NON_COMPOSABLE = new Set(["run_workflow", "orchestrate", "dispatch"]);

/** A runTool bound to the live registry, fail-closed: refuses side-effecting classes (they need the
 * interactive gate) and non-composable delegating tools. Every node runs the real tool with ctx. */
export function makeToolRunner(registry: ToolRegistry, ctx: ToolContext): (tool: string, args: Record<string, unknown>) => Promise<string> {
  return async (tool, args) => {
    if (NON_COMPOSABLE.has(tool)) throw new Error(`blocked: ${tool} can't run inside a workflow (no recursion/fan-out)`);
    const action = registry.getAction(tool);
    if (NEVER_WITHOUT_ASKING.has(action)) throw new Error(`blocked: ${tool} is ${action}-class — run it through the gated loop, not a workflow`);
    return registry.get(tool).run(args, ctx);
  };
}
