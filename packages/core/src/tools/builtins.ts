import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertWritable, decideCommand, decideEgress, jailPath, SecurityError } from "../security/policy.js";
import { AuditLog } from "../security/audit.js";
import { guardInjection } from "../security/injection.js";
import { htmlToMarkdown } from "../tokenjuice/html.js";
import { compressShellOutput } from "../tokenjuice/shellfilter.js";
import { retrieveOriginal, stashOriginal } from "../tokenjuice/reversible.js";
import { pauseTools } from "../automation/pause.js";
import { ToolRegistry } from "./registry.js";
import type { Tool } from "./types.js";

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string") throw new SecurityError(`${name} must be a string`);
  return v;
};
const clip = (s: string, max = 20_000): string => (s.length > max ? `${s.slice(0, max)}\n…[truncated]` : s);

const readFile: Tool = {
  name: "read_file",
  description: "Read a UTF-8 file inside the action directory.",
  meta: { action: "read" },
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async run(args, ctx) {
    const abs = jailPath(ctx.policy, str(args.path, "path"));
    return clip(readFileSync(abs, "utf8"));
  },
};

const writeFile: Tool = {
  name: "write_file",
  description: "Write a UTF-8 file inside the action directory (creates parent dirs).",
  meta: { action: "write" },
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  async run(args, ctx) {
    const abs = assertWritable(ctx.policy, str(args.path, "path"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, str(args.content, "content"));
    return `wrote ${abs}`;
  },
};

const listDir: Tool = {
  name: "list_dir",
  description: "List entries of a directory inside the action directory.",
  meta: { action: "read" },
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async run(args, ctx) {
    const abs = jailPath(ctx.policy, str(args.path ?? ".", "path"));
    return readdirSync(abs, { withFileTypes: true })
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .join("\n");
  },
};

const runShell: Tool = {
  name: "run_shell",
  description: "Run a shell command in the action directory's terminal and return its output.",
  meta: { action: "write" }, // command-level risk (delete/send) is graded separately by classifyCommand
  parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  async run(args, ctx) {
    const command = str(args.command, "command");
    const decision = decideCommand(ctx.policy, command);
    if (!decision.allowed) throw new SecurityError(`command refused (${decision.reason}): ${command}`);
    const { stdout, exitCode } = await ctx.terminal.exec(command);
    // Squeeze noisy command output before it enters the model context (RTK-style, in-process).
    const { text, beforeLines, afterLines } = compressShellOutput(command, stdout, exitCode ?? 0);
    let out = `exit=${exitCode}\n${text}`;
    // Reversible: when output was compressed, stash the original and offer a ref to retrieve it in full.
    if (afterLines < beforeLines) out += `\n[compressed ${beforeLines}→${afterLines} lines · retrieve_original("${stashOriginal(stdout)}") for the full output]`;
    return clip(out);
  },
};

// ponytail: module-level audit sink for read-class egress; injectable if the tools ever need per-run scoping.
const egressAudit = new AuditLog();

/** Phase 1.4/§2: warn + durably log a non-allowlisted outbound host (read-class egress stays warn-only,
 * not blocked — research must flow). Returns the banner to prepend to the tool result. */
function egressWarn(tool: string, url: string): string {
  const eg = decideEgress(url);
  if (eg.allowlisted) return "";
  egressAudit.record({ kind: "egress", tool, host: eg.host || url, verdict: "warn", reason: eg.reason ?? "not on allowlist" });
  return `[egress] outbound to non-allowlisted host "${eg.host || url}" (${eg.reason ?? "not on allowlist"})\n`;
}

const webFetch: Tool = {
  name: "web_fetch",
  description: "Fetch a URL and return its body text.",
  meta: { action: "read" }, // GET only; egress host is checked + logged by decideEgress
  parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  async run(args) {
    const url = str(args.url, "url");
    const warn = egressWarn("web_fetch", url);
    const res = await fetch(url);
    const body = await res.text();
    if (guardInjection(body) === "block") return `${warn}[web_fetch] content blocked by injection guard`;
    const isHtml = (res.headers.get("content-type") ?? "").includes("html") || /^\s*<(!doctype|html)/i.test(body);
    return warn + clip(isHtml ? htmlToMarkdown(body) : body);
  },
};

const webSearch: Tool = {
  name: "web_search",
  description: "Search the web (requires VISHU_SEARCH_URL configured).",
  meta: { action: "read" },
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  async run(args) {
    const base = process.env.VISHU_SEARCH_URL;
    if (!base) return "[web_search] not configured (set VISHU_SEARCH_URL)"; // ponytail: BYO endpoint
    const url = `${base}${encodeURIComponent(str(args.query, "query"))}`;
    const warn = egressWarn("web_search", url); // §2b: the operator-set search host is egress-checked too
    const res = await fetch(url);
    return warn + clip(await res.text());
  },
};

const retrieveOriginalTool: Tool = {
  name: "retrieve_original",
  description: "Retrieve the full, uncompressed output that was elided from an earlier compressed tool result, by its ref.",
  meta: { action: "read" },
  parameters: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
  async run(args) {
    return retrieveOriginal(str(args.ref, "ref")) ?? "[retrieve_original] unknown or expired ref";
  },
};

export function registerBuiltins(registry: ToolRegistry): ToolRegistry {
  [readFile, writeFile, listDir, runShell, webFetch, webSearch, retrieveOriginalTool, ...pauseTools].forEach((t) => registry.register(t));
  return registry;
}
