import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { registerAgent, registerAgentQueue } from "../agent/rpc.js";
import { AgentQueue } from "../agent/queue.js";
import { SessionStore } from "../agent/session.js";
import { buildApp } from "../appbuilder/build.js";
import { formatFindings } from "../appbuilder/security.js";
import { type AppSpec, type InterviewTurn, interviewStep, persistSpec, specToMarkdown } from "../appbuilder/spec.js";
import { AgentService } from "../agent/service.js";
import { loadConfig } from "../config/config.js";
import { registerAutomation } from "../automation/rpc.js";
import { SchedulerGate } from "../automation/gate.js";
import { attachNotificationSink } from "../automation/notify.js";
import { startResourceGuard } from "../automation/sensor.js";
import { TriggerManager } from "../automation/triggers.js";
import { WorkflowStore } from "../automation/workflows.js";
import { registerConnectors } from "../connectors/rpc.js";
import { LocalConnector } from "../connectors/local.js";
import { McpClient, type McpSampler, registerMcpTools } from "../connectors/mcp.js";
import { WebhookConnector } from "../connectors/webhook.js";
import type { Connector } from "../connectors/types.js";
import { registerMemory } from "../memory/rpc.js";
import { MODULES } from "../modules/all.js";
import { loadModules } from "../modules/registry.js";
import { MemoryStore } from "../memory/store.js";
import { registerMemoryTools } from "../memory/tools.js";
import { ProjectEvolver, runEvolutionPass } from "../personalization/evolve.js";
import { DigitalTwin } from "../personalization/twin.js";
import { registerEvolve, registerTwin } from "../personalization/rpc.js";
import { registerOrchestrationTools } from "../orchestration/tools.js";
import { buildRoles } from "../orchestration/roles.js";
import { buildRouter } from "../providers/factory.js";
import { RunLog } from "../reliability/runlog.js";
import { makePolicy } from "../security/policy.js";
import { SkillIndex } from "../skills/index.js";
import { registerSkillTools } from "../skills/tools.js";
import { registerBuiltins } from "../tools/builtins.js";
import { runToolLoop } from "../tools/loop.js";
import { ToolRegistry } from "../tools/registry.js";
import { Terminal } from "../tools/terminal.js";
import { initToken } from "../transport/auth.js";
import { registerUsage } from "../usage/rpc.js";
import { BudgetWatcher } from "../usage/budget.js";
import { UsageLog, readUsage } from "../usage/log.js";
import { buildReport, renderReport } from "../usage/report.js";
import { buildRegistry } from "../transport/all.js";
import { bus } from "../transport/events.js";
import { rpcCall, readToken } from "../transport/client.js";
import { startServer } from "../transport/server.js";

function version(): string {
  // dist/bin/vishu.js (or src/bin/vishu.ts under tsx) -> package root is ../../
  const pkgPath = join(import.meta.dirname, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

function host(env = process.env): string {
  return env.VISHU_CORE_HOST || "127.0.0.1";
}

/** Connect MCP servers declared in VISHU_MCP_SERVERS (JSON: [{id,cmd,args?}]) and fold their tools in.
 * A server that fails to start is logged and skipped — it must never take down the core. */
async function connectMcpServers(tools: ToolRegistry, eventBus: typeof bus, sampler?: McpSampler): Promise<void> {
  const raw = process.env.VISHU_MCP_SERVERS;
  if (!raw) return;
  let specs: { id: string; cmd: string; args?: string[] }[];
  try {
    specs = JSON.parse(raw) as typeof specs;
  } catch {
    process.stderr.write("[mcp] VISHU_MCP_SERVERS is not valid JSON; skipping\n");
    return;
  }
  for (const s of specs) {
    try {
      const client = new McpClient(s.cmd, s.args ?? [], { sampler });
      await client.start();
      const names = await registerMcpTools(tools, client, s.id, eventBus);
      process.stdout.write(`[mcp] ${s.id}: ${names.length} tool(s)\n`);
    } catch (e) {
      process.stderr.write(`[mcp] ${s.id} failed: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
}

/** Outbound webhook channels declared in VISHU_WEBHOOKS (JSON: {"channel":"https://hook"}). */
function parseWebhooks(env = process.env): Record<string, string> {
  if (!env.VISHU_WEBHOOKS) return {};
  try {
    return JSON.parse(env.VISHU_WEBHOOKS) as Record<string, string>;
  } catch {
    process.stderr.write("[connectors] VISHU_WEBHOOKS is not valid JSON; skipping\n");
    return {};
  }
}

function usageErr(usage: string): number {
  process.stderr.write(`usage: ${usage}\n`);
  return 1;
}

/** Token ledger under the private workspace — every command's model calls funnel through it. */
function usageLog(config: ReturnType<typeof loadConfig>): UsageLog {
  mkdirSync(config.paths.workspaceDir, { recursive: true });
  return new UsageLog(join(config.paths.workspaceDir, "usage.jsonl"));
}

async function serve(): Promise<number> {
  const config = loadConfig();
  initToken(config.paths.workspaceDir);
  mkdirSync(config.paths.actionDir, { recursive: true });
  const registry = buildRegistry(version(), config.port);
  const tools = registerBuiltins(new ToolRegistry());
  const skills = new SkillIndex();
  skills.loadDir(config.paths.skillsDir);
  registerSkillTools(tools, skills);
  const usage = usageLog(config);
  const router = buildRouter(config.provider, usage);
  const roles = buildRoles(router, config.providers, config.roles, usage);
  if (roles.roles().length) process.stdout.write(`[roles] ${roles.roles().map((r) => `${r}→${config.roles[r]}`).join(", ")}\n`);
  const memory = new MemoryStore(
    config.paths.vaultDir,
    config.paths.memoryDbFile,
    join(config.paths.workspaceDir, "memory-events.log"),
    router.canEmbed() ? (texts) => router.embed(texts) : undefined,
  );
  registerMemoryTools(tools, memory);
  registerMemory(registry, memory);
  registerUsage(registry, config.paths.workspaceDir);
  registerOrchestrationTools(tools, { roles, model: config.provider.model });
  const sessions = new SessionStore();
  const twin = new DigitalTwin(join(config.paths.workspaceDir, "twin.json"));
  const agentService = new AgentService({
    router,
    tools,
    policy: makePolicy("full", config.paths.actionDir),
    terminal: new Terminal(config.paths.actionDir),
    model: config.provider.model,
    runLog: new RunLog(),
    twin,
  }, sessions);
  registerAgent(registry, agentService);

  // Agent-level task queue: fire-and-poll multitasking, N turns at once (VISHU_AGENT_CONCURRENCY, default 2).
  // Each task gets its own Terminal so concurrent shells don't interleave; the session store is shared.
  const agentConcurrency = Number(process.env.VISHU_AGENT_CONCURRENCY) || 2;
  const agentQueue = new AgentQueue(async (sid, msg) => {
    const terminal = new Terminal(config.paths.actionDir);
    try {
      const svc = new AgentService(
        { router, tools, policy: makePolicy("full", config.paths.actionDir), terminal, model: config.provider.model, runLog: new RunLog(), twin },
        sessions,
      );
      return await svc.startTurn(sid, msg);
    } finally {
      terminal.close();
    }
  }, agentConcurrency);
  registerAgentQueue(registry, agentQueue);

  // Phase 9: proactive automation — saved workflows + triggers on a 5s cron tick / events / files.
  const workflows = new WorkflowStore(join(config.paths.workspaceDir, "workflows"));
  const gate = new SchedulerGate();
  const triggers = new TriggerManager({
    bus,
    store: workflows,
    gate,
    autonomy: "automatic",
    run: async (step) => (await agentService.startTurn(undefined, step)).final,
    runLog: new RunLog(),
  });
  registerAutomation(registry, workflows, triggers);
  triggers.start();

  // Phase 13: self-evolving loop — scan the action dir for cheap improvements on a daily cron and
  // record them as suggest-only proposals (never auto-applied). Reachable over vishu.evolve_*.
  const evolver = new ProjectEvolver(join(config.paths.workspaceDir, "evolve.json"));
  registerEvolve(registry, evolver, workflows);
  registerTwin(registry, twin, workflows);
  const evolveTick = () => runEvolutionPass(evolver, config.paths.actionDir, bus);
  evolveTick(); // one pass at startup
  setInterval(evolveTick, 86_400_000).unref(); // daily; unref so it never holds the process open
  startResourceGuard(gate); // throttle background work under CPU load
  attachNotificationSink(bus); // surface trigger notifications (Phase 14 swaps in an OS toast)
  if (config.budgetUsd > 0) {
    new BudgetWatcher(join(config.paths.workspaceDir, "usage.jsonl"), config.budgetUsd, bus).start();
    process.stdout.write(`[budget] weekly alert at $${config.budgetUsd}\n`);
  }

  // Phase 10: connectors — inbound triage + outbound send RPC, MCP servers, realtime SSE stream.
  const connectors = new Map<string, Connector>([["local", new LocalConnector()]]);
  for (const [channel, url] of Object.entries(parseWebhooks())) connectors.set(channel, new WebhookConnector(channel, url));
  registerConnectors(registry, { router, model: config.provider.model, memory, bus, runLog: new RunLog() }, connectors);
  // MCP sampling: a server's sampling/createMessage runs through our Router and returns an MCP result.
  const sampler: McpSampler = async (params) => {
    const p = (params ?? {}) as { messages?: { role: string; content?: { text?: string } }[] };
    const messages = (p.messages ?? []).map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content?.text ?? "" }));
    let text = "";
    await router.chatStream({ model: config.provider.model, messages, category: "mcp" }, (d) => (text += d));
    return { role: "assistant", content: { type: "text", text }, model: config.provider.model };
  };
  await connectMcpServers(tools, bus, sampler);

  // Phase 12: optional modules — off by default, enabled by VISHU_MODULES; core is unaffected when off.
  const modulesOn = await loadModules(MODULES, { tools, rpc: registry, bus, workspaceDir: config.paths.workspaceDir });
  if (modulesOn.length) process.stdout.write(`[modules] enabled: ${modulesOn.join(", ")}\n`);

  const corsOrigins = process.env.VISHU_CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean);
  const running = await startServer(registry, host(), config.port, bus, corsOrigins);
  const base = `http://${host()}:${running.port}`;
  process.stdout.write(`[serve] vishu ${version()} on ${base}\n`);
  process.stdout.write(`[serve] token: ${join(config.paths.workspaceDir, "core.token")}\n`);
  process.stdout.write(`[serve] methods: ${registry.methods().join(", ")}\n`);
  const stop = () => void running.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return new Promise<number>(() => {}); // run until signalled
}

async function chat(text: string): Promise<number> {
  const config = loadConfig();
  const router = buildRouter(config.provider, usageLog(config));
  await router.chatStream(
    { model: config.provider.model, messages: [{ role: "user", content: text }], category: "chat" },
    (d) => process.stdout.write(d),
  );
  process.stdout.write("\n");
  return 0;
}

async function agent(text: string): Promise<number> {
  const config = loadConfig();
  mkdirSync(config.paths.actionDir, { recursive: true });
  const registry = registerBuiltins(new ToolRegistry());
  const result = await runToolLoop(
    {
      router: buildRouter(config.provider, usageLog(config)),
      registry,
      policy: makePolicy("full", config.paths.actionDir),
      terminal: new Terminal(config.paths.actionDir),
      model: config.provider.model,
    },
    [
      { role: "system", content: "You are Vishu, a coding agent. Use the tools to build, run, and verify work strictly inside the action directory." },
      { role: "user", content: text },
    ],
  );
  process.stdout.write(`${result.final}\n`);
  return 0;
}

/** Phase 11 flagship: spec interview → user verifies → chunked secure build → security + gate report. */
async function build(goal: string): Promise<number> {
  const config = loadConfig();
  mkdirSync(config.paths.actionDir, { recursive: true });
  const router = buildRouter(config.provider, usageLog(config));
  const model = config.provider.model;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const turns: InterviewTurn[] = [];
    let spec: AppSpec | undefined;
    for (let round = 0; round < 8 && !spec; round++) {
      const step = await interviewStep(router, model, goal, turns);
      if (step.kind === "spec") spec = step.spec;
      else for (const q of step.questions) turns.push({ q, a: await rl.question(`? ${q}\n> `) });
    }
    if (!spec) {
      process.stderr.write("[build] could not converge on a spec; try a more specific goal\n");
      return 1;
    }

    process.stdout.write(`\n${specToMarkdown(spec)}\n\n`);
    const answer = (await rl.question("Build this spec? [y/N] ")).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      process.stdout.write("[build] aborted before any code\n");
      return 0;
    }

    const memory = new MemoryStore(
      config.paths.vaultDir,
      config.paths.memoryDbFile,
      join(config.paths.workspaceDir, "memory-events.log"),
      router.canEmbed() ? (texts) => router.embed(texts) : undefined,
    );
    await persistSpec(memory, spec);
    memory.close();

    process.stdout.write("[build] building…\n");
    const report = await buildApp(
      {
        router,
        model,
        policy: makePolicy("full", config.paths.actionDir),
        registry: registerBuiltins(new ToolRegistry()),
        repoDir: config.paths.actionDir,
        runLog: new RunLog(),
      },
      spec,
    );

    process.stdout.write(
      [
        "",
        `[build] ${report.ok ? "DONE" : "BLOCKED"} — ${report.chunks.length} chunk(s), ${report.remediations} security remediation(s)`,
        `security: ${formatFindings(report.findings)}`,
        `gate: ${report.gate.ok ? "pass" : report.gate.issues.join("; ")}`,
        `owasp review (advisory): ${report.review || "none"}`,
        "",
      ].join("\n"),
    );
    return report.ok ? 0 : 1;
  } finally {
    rl.close();
  }
}

/** Weekly token report straight from the local ledger (no running core needed). */
function report(daysArg?: string): number {
  const config = loadConfig();
  const days = daysArg ? Number(daysArg) : 7;
  if (!Number.isFinite(days) || days <= 0) return usageErr("vishu report [days]");
  const records = readUsage(join(config.paths.workspaceDir, "usage.jsonl"));
  process.stdout.write(`${renderReport(buildReport(records, days * 86_400_000), days)}\n`);
  return 0;
}

async function rpc(method: string, paramsJson?: string): Promise<number> {
  const config = loadConfig();
  const token = readToken(config.paths.workspaceDir);
  const params = paramsJson ? (JSON.parse(paramsJson) as unknown) : undefined;
  const res = await rpcCall(`http://${host()}:${config.port}`, token, method, params);
  process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  return res.error || (res.result && res.result.ok === false) ? 1 : 0;
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];

  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (cmd === "config") {
    process.stdout.write(`${JSON.stringify(loadConfig(), null, 2)}\n`);
    return 0;
  }
  if (cmd === "serve") return serve();
  if (cmd === "chat") {
    const text = argv.slice(1).join(" ");
    if (!text) return usageErr("vishu chat <message>");
    return chat(text);
  }
  if (cmd === "agent") {
    const text = argv.slice(1).join(" ");
    if (!text) return usageErr("vishu agent <task>");
    return agent(text);
  }
  if (cmd === "build") {
    const text = argv.slice(1).join(" ");
    if (!text) return usageErr("vishu build <what to build>");
    return build(text);
  }
  if (cmd === "report") return report(argv[1]);
  if (cmd === "rpc") {
    const method = argv[1];
    if (!method) return usageErr("vishu rpc <method> [jsonParams]");
    return rpc(method, argv[2]);
  }

  process.stdout.write(
    [
      `vishu ${version()}`,
      "",
      "Usage:",
      "  vishu --version              print version",
      "  vishu config                 print resolved config + paths",
      "  vishu serve                  start the JSON-RPC core (loopback)",
      "  vishu chat <message>         one-shot chat via the configured provider",
      "  vishu agent <task>           run the tool loop (build/run inside action_dir)",
      "  vishu build <what>           guided secure app builder: spec interview → build → pentest",
      "  vishu report [days]          weekly token report: where tokens go + where they're wasted",
      "  vishu rpc <method> [json]    call a method on a running core",
      "",
    ].join("\n"),
  );
  return cmd && cmd !== "help" && cmd !== "--help" ? 1 : 0;
}

process.exit(await main(process.argv.slice(2)));
