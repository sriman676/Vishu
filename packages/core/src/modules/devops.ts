import type { ToolContext } from "../tools/types.js";
import type { VishuModule } from "./registry.js";

/** Run one shell command in the sandbox Terminal and render `exit N` + trimmed output. */
async function sh(ctx: ToolContext, command: string): Promise<string> {
  const out = await ctx.terminal.exec(command);
  const body = out.stdout.trim();
  return `exit ${out.exitCode ?? "?"}${body ? `\n${body}` : ""}`;
}

/** Reject a string that would break out of the single-quoted/`-m "..."` command it is spliced into.
 * The agent already has `run_shell` for arbitrary commands, so this is correctness + defense-in-depth,
 * not the security boundary: keep commit messages / refs well-formed and free of shell metacharacters. */
function safeArg(s: string, allow: RegExp): string | undefined {
  return allow.test(s) ? s : undefined;
}

/** CF1 coding co-founder module (flag: `devops`). Higher-level dev-workflow tools over the sandbox
 * Terminal: status/diff/lint (read), test/format/commit (write), and push/deploy (send — ALWAYS gated,
 * matching the "never autonomously push/deploy" rule). Heavy multi-approach building goes through the
 * `orchestrate` tool (hypothesis tree on the builder role); this is the everyday dev surface a coder
 * agent reaches for. ponytail: thin, correctly-action-classed wrappers over the shell — the value is the
 * gate class (push/deploy always ask) and stable tool names dispatch/agents can target, not new power. */
export const devopsModule: VishuModule = {
  name: "devops",
  setup({ tools }) {
    const testCmd = process.env.VISHU_TEST_CMD ?? "npm test";
    const lintCmd = process.env.VISHU_LINT_CMD ?? "npm run lint";
    const fmtCmd = process.env.VISHU_FORMAT_CMD ?? "npm run format";

    tools.register({
      name: "dev_status",
      meta: { action: "read" },
      description: "git status of the action sandbox (branch + short status).",
      parameters: { type: "object", properties: {} },
      run: (_a, ctx) => sh(ctx, "git status --short --branch"),
    });

    tools.register({
      name: "dev_diff",
      meta: { action: "read" },
      description: "git diff of changes (set staged:true for the index).",
      parameters: { type: "object", properties: { staged: { type: "boolean" } } },
      run: (a, ctx) => sh(ctx, `git diff${a.staged === true ? " --cached" : ""}`),
    });

    tools.register({
      name: "dev_test",
      meta: { action: "write" },
      description: "Run the project's test command (VISHU_TEST_CMD, default 'npm test'; or pass one).",
      parameters: { type: "object", properties: { command: { type: "string" } } },
      run: (a, ctx) => sh(ctx, a.command ? String(a.command) : testCmd),
    });

    tools.register({
      name: "dev_lint",
      meta: { action: "read" },
      description: "Run the lint command (VISHU_LINT_CMD, default 'npm run lint').",
      parameters: { type: "object", properties: {} },
      run: (_a, ctx) => sh(ctx, lintCmd),
    });

    tools.register({
      name: "dev_format",
      meta: { action: "write" },
      description: "Run the formatter (VISHU_FORMAT_CMD, default 'npm run format').",
      parameters: { type: "object", properties: {} },
      run: (_a, ctx) => sh(ctx, fmtCmd),
    });

    tools.register({
      name: "dev_commit",
      meta: { action: "write" },
      description: "Stage all changes and commit with a message (in the sandbox).",
      parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
      run: async (a, ctx) => {
        const msg = safeArg(String(a.message ?? "").trim(), /^[^"`$\r\n\\]{1,200}$/);
        if (!msg) return 'error: message is required and must be a single line without " ` $ \\ characters';
        await ctx.terminal.exec("git add -A");
        return sh(ctx, `git commit -m "${msg}"`);
      },
    });

    // Always-gated (send): the human approves every push/deploy — never autonomous.
    tools.register({
      name: "dev_push",
      meta: { action: "send" },
      description: "Push commits to a remote (ALWAYS asks for approval).",
      parameters: { type: "object", properties: { remote: { type: "string" }, branch: { type: "string" } } },
      run: async (a, ctx) => {
        const remote = safeArg(String(a.remote ?? "origin"), /^[\w.\/-]{1,100}$/);
        const branch = safeArg(String(a.branch ?? "HEAD"), /^[\w.\/-]{1,100}$/);
        if (!remote || !branch) return "error: remote/branch may contain only word, '.', '/', '-' characters";
        return sh(ctx, `git push ${remote} ${branch}`);
      },
    });

    tools.register({
      name: "dev_deploy",
      meta: { action: "send" },
      description: "Run an explicit deploy command (ALWAYS asks for approval). No default — pass the command.",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      run: async (a, ctx) => {
        const command = String(a.command ?? "").trim();
        if (!command) return "error: a deploy command is required";
        return sh(ctx, command);
      },
    });
  },
};
