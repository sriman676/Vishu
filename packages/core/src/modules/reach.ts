import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import type { VishuModule } from "./registry.js";

const execFileP = promisify(execFile);

// The free-for-dev list is a cloned reference (capability install on D:); overridable for other layouts.
const FFD_PATH = process.env.FREE_FOR_DEV_MD ?? "D:/claude-tools/repos/free-for-dev/README.md";
// Agent-Reach's own CLI (its pyproject console_script). Read-only subcommands only — no setup/install/
// uninstall is ever run from a tool call. On Windows a bare name resolving to a .cmd needs cmd /c (the
// same post-CVE-2024-27980 EINVAL issue the MCP client handles).
const REACH_CMD = process.env.AGENT_REACH_BIN ?? "agent-reach";
const REACH_OK = new Set(["doctor", "version", "check-update", "watch", "transcribe"]);

/** Search the ripienaar/free-for-dev list for services matching a query. Pure over the markdown so it
 * unit-tests without the file. Each hit is a "* [Name](url) - desc" bullet, returned as "Name — desc (url)". */
export function searchFreeForDev(md: string, query: string, limit = 15): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: string[] = [];
  for (const line of md.split("\n")) {
    const m = /^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*[-–—]?\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, name, url, desc] = m;
    if (`${name} ${desc}`.toLowerCase().includes(q)) {
      out.push(desc ? `${name} — ${desc} (${url})` : `${name} (${url})`);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** §11 integrations (flag: `reach`): a free-tier finder over the free-for-dev list + a gated passthrough
 * to the Agent-Reach capability CLI (Panniantong/agent-reach). Both degrade to a clear "not installed"
 * message rather than crashing — the core is never blocked. No self-install is ever run from here; the
 * passthrough is limited to read-only subcommands. */
export const reachModule: VishuModule = {
  name: "reach",
  setup({ tools }) {
    tools.register({
      name: "free_for_dev",
      description: "Find dev services with a free tier from the free-for-dev list (query by name/keyword).",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      run: async (args) => {
        const query = String(args.query ?? "");
        if (!query.trim()) return "error: query is required";
        if (!existsSync(FFD_PATH)) return `error: free-for-dev not installed at ${FFD_PATH} (clone ripienaar/free-for-dev or set FREE_FOR_DEV_MD)`;
        const hits = searchFreeForDev(readFileSync(FFD_PATH, "utf8"), query);
        return hits.length ? hits.join("\n") : `no free-tier services matched "${query}"`;
      },
    });

    tools.register({
      name: "web_reach",
      description: "Query the Agent-Reach web capability layer: doctor (platform availability), version, check-update, watch, or transcribe a URL.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "doctor|version|check-update|watch|transcribe (default doctor)" },
          url: { type: "string", description: "for transcribe: the media URL" },
        },
      },
      run: async (args) => {
        const command = String(args.command ?? "doctor");
        if (!REACH_OK.has(command)) return `error: unsupported command "${command}" (allowed: ${[...REACH_OK].join(", ")})`;
        const argv = command === "transcribe" ? [command, String(args.url ?? "")] : [command];
        if (command === "transcribe" && !argv[1]) return "error: transcribe requires a url";
        const [cmd, cargs] =
          process.platform === "win32" && !/[\\/]/.test(REACH_CMD) ? ["cmd", ["/c", REACH_CMD, ...argv]] : [REACH_CMD, argv];
        try {
          const { stdout } = await execFileP(cmd, cargs, { timeout: 120_000 });
          return stdout.trim() || "(no output)";
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/ENOENT|not recognized|not found/i.test(msg)) {
            return "Agent-Reach CLI not installed. Clone Panniantong/agent-reach and run its docs/install.md setup (I don't auto-install), or set AGENT_REACH_BIN.";
          }
          return `error: ${msg}`;
        }
      },
    });
  },
};
