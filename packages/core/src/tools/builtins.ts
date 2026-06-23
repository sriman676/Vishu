import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertWritable, decideCommand, jailPath, SecurityError } from "../security/policy.js";
import { guardInjection } from "../security/injection.js";
import { htmlToMarkdown } from "../tokenjuice/html.js";
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
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async run(args, ctx) {
    const abs = jailPath(ctx.policy, str(args.path, "path"));
    return clip(readFileSync(abs, "utf8"));
  },
};

const writeFile: Tool = {
  name: "write_file",
  description: "Write a UTF-8 file inside the action directory (creates parent dirs).",
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
  parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  async run(args, ctx) {
    const command = str(args.command, "command");
    const decision = decideCommand(ctx.policy, command);
    if (!decision.allowed) throw new SecurityError(`command refused (${decision.reason}): ${command}`);
    const { stdout, exitCode } = await ctx.terminal.exec(command);
    return clip(`exit=${exitCode}\n${stdout}`);
  },
};

const webFetch: Tool = {
  name: "web_fetch",
  description: "Fetch a URL and return its body text.",
  parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  async run(args) {
    const url = str(args.url, "url");
    const res = await fetch(url);
    const body = await res.text();
    if (guardInjection(body) === "block") return "[web_fetch] content blocked by injection guard";
    const isHtml = (res.headers.get("content-type") ?? "").includes("html") || /^\s*<(!doctype|html)/i.test(body);
    return clip(isHtml ? htmlToMarkdown(body) : body);
  },
};

const webSearch: Tool = {
  name: "web_search",
  description: "Search the web (requires VISHU_SEARCH_URL configured).",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  async run(args) {
    const base = process.env.VISHU_SEARCH_URL;
    if (!base) return "[web_search] not configured (set VISHU_SEARCH_URL)"; // ponytail: BYO endpoint
    const res = await fetch(`${base}${encodeURIComponent(str(args.query, "query"))}`);
    return clip(await res.text());
  },
};

export function registerBuiltins(registry: ToolRegistry): ToolRegistry {
  [readFile, writeFile, listDir, runShell, webFetch, webSearch].forEach((t) => registry.register(t));
  return registry;
}
