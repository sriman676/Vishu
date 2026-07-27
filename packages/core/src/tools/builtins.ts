import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertWritable, decideCommand, decideEgress, jailPath, SecurityError } from "../security/policy.js";
import { AuditLog } from "../security/audit.js";
import { guardInjection } from "../security/injection.js";
import { htmlToMarkdown } from "../tokenjuice/html.js";
import { compressShellOutput } from "../tokenjuice/shellfilter.js";
import { retrieveOriginal, stashOriginal } from "../tokenjuice/reversible.js";
import { pauseTools } from "../automation/pause.js";
import { ToolRegistry } from "./registry.js";
import type { Tool, ToolContext } from "./types.js";

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

const editFile: Tool = {
  name: "edit_file",
  description:
    "Replace an exact substring in a UTF-8 file inside the action directory (surgical edit, unlike write_file which overwrites). `old` must match exactly; it must appear once unless `replaceAll` is set. Fails if not found.",
  meta: { action: "write" },
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      old: { type: "string", description: "exact text to replace (include surrounding context to make it unique)" },
      new: { type: "string", description: "replacement text" },
      replaceAll: { type: "boolean", description: "replace every occurrence instead of requiring a unique match" },
    },
    required: ["path", "old", "new"],
  },
  async run(args, ctx) {
    const abs = assertWritable(ctx.policy, str(args.path, "path"));
    const oldText = str(args.old, "old");
    const newText = str(args.new, "new");
    if (oldText === newText) throw new SecurityError("edit_file: old and new are identical");
    const src = readFileSync(abs, "utf8");
    const count = oldText ? src.split(oldText).length - 1 : 0;
    if (count === 0) throw new SecurityError(`edit_file: text not found in ${args.path}`);
    if (count > 1 && !args.replaceAll) throw new SecurityError(`edit_file: text appears ${count}× in ${args.path} — add surrounding context or pass replaceAll`);
    const out = args.replaceAll ? src.split(oldText).join(newText) : src.replace(oldText, newText);
    writeFileSync(abs, out);
    const n = args.replaceAll ? count : 1;
    return `edited ${abs} (${n} replacement${n === 1 ? "" : "s"})`;
  },
};

const grep: Tool = {
  name: "grep",
  description:
    "Search file CONTENTS by regex (case-insensitive) under the action directory; returns path:line:text, capped at 200 hits. Skips node_modules/.git/dist and binary files. This is literal code search — distinct from file_search (semantic index).",
  meta: { action: "read" },
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "a JavaScript regular expression" },
      path: { type: "string", description: "subdirectory to search (default the action dir root)" },
      glob: { type: "string", description: "only files whose name contains this substring (e.g. '.ts')" },
    },
    required: ["pattern"],
  },
  // ponytail: naive recursive walk + per-line regex, capped. Swap in ripgrep via run_shell if a huge repo
  // makes this slow, or add proper glob matching if substring filtering proves too coarse.
  async run(args, ctx) {
    const root = jailPath(ctx.policy, str(args.path ?? ".", "path"));
    let re: RegExp;
    try {
      re = new RegExp(str(args.pattern, "pattern"), "i");
    } catch (e) {
      throw new SecurityError(`grep: invalid regex: ${(e as Error).message}`);
    }
    const nameFilter = args.glob ? String(args.glob) : "";
    const cap = 200;
    const hits: string[] = [];
    const walk = (dir: string): void => {
      if (hits.length >= cap) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (hits.length >= cap) return;
        if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          walk(p);
          continue;
        }
        if (nameFilter && !e.name.includes(nameFilter)) continue;
        let text: string;
        try {
          text = readFileSync(p, "utf8");
        } catch {
          continue; // unreadable / vanished
        }
        if (text.includes(String.fromCharCode(0))) continue; // skip binary (NUL byte)
        const lines = text.split("\n");
        for (let i = 0; i < lines.length && hits.length < cap; i++) {
          if (re.test(lines[i]!)) hits.push(`${p}:${i + 1}:${lines[i]!.trim().slice(0, 200)}`);
        }
      }
    };
    walk(root);
    return hits.length ? clip(hits.join("\n")) : "[grep] no matches";
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

/** Minimal glob → RegExp: `**` spans directories, `*` matches within a segment, `?` one char. Anchored
 * whole-path so "src/**\/*.test.ts" only matches those files. ponytail: no brace/extglob — add if needed. */
function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*"; // ** — across path separators
        i++;
        if (pattern[i + 1] === "/") i++; // swallow the slash after ** so "**/x" also matches "x"
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const glob: Tool = {
  name: "glob",
  description:
    "Find files by NAME pattern under the action directory (e.g. 'src/**/*.ts', '**/*.test.ts'). Returns matching relative paths, capped at 500. Distinct from grep (content search) and file_search (semantic index).",
  meta: { action: "read" },
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "a glob like 'src/**/*.ts' — ** spans dirs, * within a segment" },
      path: { type: "string", description: "subdirectory to search (default the action dir root)" },
    },
    required: ["pattern"],
  },
  async run(args, ctx) {
    const root = jailPath(ctx.policy, str(args.path ?? ".", "path"));
    const re = globToRegExp(str(args.pattern, "pattern"));
    const cap = 500;
    const out: string[] = [];
    const walk = (dir: string, rel: string): void => {
      if (out.length >= cap) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (out.length >= cap) return;
        if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
        const relPath = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(dir, e.name), relPath);
        else if (re.test(relPath)) out.push(relPath);
      }
    };
    walk(root, "");
    return out.length ? clip(out.sort().join("\n")) : "[glob] no matches";
  },
};

const TODO_FILE = ".vishu-todo.json";
interface TodoItem {
  text: string;
  done: boolean;
}
function readTodo(ctx: ToolContext): TodoItem[] {
  try {
    return JSON.parse(readFileSync(jailPath(ctx.policy, TODO_FILE), "utf8")) as TodoItem[];
  } catch {
    return [];
  }
}
function renderTodo(items: TodoItem[]): string {
  return items.length ? items.map((t, i) => `${i + 1}. [${t.done ? "x" : " "}] ${t.text}`).join("\n") : "(no todos)";
}

const todo: Tool = {
  name: "todo",
  description:
    "Track a task checklist across turns (persisted in the action dir). action=list (default) shows it; add appends `text`; done marks item `index` (1-based) complete; clear empties it. Use to plan and track multi-step work.",
  meta: { action: "write" }, // mutates a workspace file (add/done/clear); list is the harmless default
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "add", "done", "clear"] },
      text: { type: "string", description: "the item text (for add)" },
      index: { type: "number", description: "1-based item number (for done)" },
    },
  },
  async run(args, ctx) {
    const action = String(args.action ?? "list");
    const path = jailPath(ctx.policy, TODO_FILE);
    let items = readTodo(ctx);
    if (action === "add") {
      items.push({ text: str(args.text, "text"), done: false });
    } else if (action === "done") {
      const i = Number(args.index) - 1;
      if (!Number.isInteger(i) || i < 0 || i >= items.length) return `[todo] no item ${args.index}`;
      items[i]!.done = true;
    } else if (action === "clear") {
      items = [];
    } else if (action !== "list") {
      return `[todo] unknown action "${action}"`;
    }
    if (action !== "list") {
      assertWritable(ctx.policy, path);
      writeFileSync(path, JSON.stringify(items));
    }
    return renderTodo(items);
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

/** Pull absolute, same-origin-resolvable hrefs out of raw HTML (hash-only anchors dropped). */
function extractLinks(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#][^"']*)["']/gi)) {
    try {
      out.push(new URL(m[1]!, base).toString());
    } catch {
      /* skip un-parseable href */
    }
  }
  return out;
}

const webCrawl: Tool = {
  name: "web_crawl",
  description: "Crawl a site from a start URL, following same-origin links breadth-first up to page/depth caps; returns each page as markdown.",
  meta: { action: "read" }, // GET-only; every fetched host is egress-checked + logged like web_fetch
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      maxPages: { type: "number", description: "max pages to fetch (default 10, hard cap 50)" },
      maxDepth: { type: "number", description: "link-follow depth from the start URL (default 2)" },
    },
    required: ["url"],
  },
  // ponytail: same-origin BFS, no robots.txt and no JS rendering. Add a per-host throttle + robots
  // respect before crawling foreign sites at volume; add a headless renderer only if SPAs need it.
  async run(args) {
    const start = str(args.url, "url");
    const maxPages = Math.min(Math.max(1, Math.floor(Number(args.maxPages ?? 10)) || 10), 50);
    const maxDepth = Math.max(0, Math.floor(Number(args.maxDepth ?? 2)) || 0);
    const origin = new URL(start).origin;
    const seen = new Set<string>([start]);
    const queue: { url: string; depth: number }[] = [{ url: start, depth: 0 }];
    const pages: string[] = [];
    while (queue.length && pages.length < maxPages) {
      const { url, depth } = queue.shift()!;
      const warn = egressWarn("web_crawl", url);
      let body: string;
      try {
        body = await (await fetch(url)).text();
      } catch (e) {
        pages.push(`## ${url}\n${warn}[web_crawl] fetch failed: ${(e as Error).message}`);
        continue;
      }
      if (guardInjection(body) === "block") {
        pages.push(`## ${url}\n${warn}[web_crawl] content blocked by injection guard`);
        continue;
      }
      pages.push(`## ${url}\n${warn}${clip(htmlToMarkdown(body), 8_000)}`);
      if (depth < maxDepth) {
        for (const href of extractLinks(body, url)) {
          if (href.startsWith(origin) && !seen.has(href) && seen.size < maxPages * 8) {
            seen.add(href);
            queue.push({ url: href, depth: depth + 1 });
          }
        }
      }
    }
    return pages.join("\n\n---\n\n");
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
  [readFile, writeFile, editFile, grep, glob, todo, listDir, runShell, webFetch, webSearch, webCrawl, retrieveOriginalTool, ...pauseTools].forEach((t) => registry.register(t));
  return registry;
}
