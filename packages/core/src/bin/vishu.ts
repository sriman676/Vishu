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
import { loadConfig, providerPresets, resolveBuilderModel } from "../config/config.js";
import { ok as okRpc } from "../transport/rpc.js";
import { registerAutomation, registerAutofix } from "../automation/rpc.js";
import { SchedulerGate } from "../automation/gate.js";
import { attachNotificationSink } from "../automation/notify.js";
import { startResourceGuard } from "../automation/sensor.js";
import { TriggerManager } from "../automation/triggers.js";
import { WorkflowStore } from "../automation/workflows.js";
import { registerConnectors } from "../connectors/rpc.js";
import { LocalConnector } from "../connectors/local.js";
import { McpClient, type McpSampler, registerMcpTools } from "../connectors/mcp.js";
import { DomainManager, loadDomains } from "../connectors/domains.js";
import { WebhookConnector } from "../connectors/webhook.js";
import type { Connector } from "../connectors/types.js";
import { registerMemory } from "../memory/rpc.js";
import { MODULES } from "../modules/all.js";
import { loadModules } from "../modules/registry.js";
import { MemoryStore } from "../memory/store.js";
import { registerMemoryTools } from "../memory/tools.js";
import { ProjectEvolver, runEvolutionPass } from "../personalization/evolve.js";
import { DigitalTwin } from "../personalization/twin.js";
import { IdentityProfile } from "../personalization/profile.js";
import { registerEvolve, registerProfile, registerTwin } from "../personalization/rpc.js";
import { registerOrchestrationTools } from "../orchestration/tools.js";
import { AgentFactory } from "../orchestration/factory.js";
import { ModeManager, registerModeTools } from "../orchestration/modes.js";
import { buildRoles } from "../orchestration/roles.js";
import { registerReasoning } from "../reasoning/rpc.js";
import { registerReasoningTools } from "../reasoning/tools.js";
import { Cassette, type ReplayMode } from "../replay/cassette.js";
import { registerReplay } from "../replay/rpc.js";
import { registerEval as registerEvalRpc } from "../eval/rpc.js";
import { EvalHistory } from "../eval/history.js";
import { renderEval } from "../eval/report.js";
import { runEval } from "../eval/runner.js";
import { makeRunners } from "../eval/runners.js";
import { BUILTIN_SUITE } from "../eval/suite.js";
import { loadSweBenchLite, runSweBench } from "../eval/swebench.js";
import { buildPoolRouter, buildRouter } from "../providers/factory.js";
import { RunLog } from "../reliability/runlog.js";
import { makeAsk, terminalPrompt } from "../reliability/ask.js";
import { AuditLog } from "../security/audit.js";
import { assertBoot, selfCheck } from "../reliability/selfcheck.js";
import { isPaused, pause, pauseFile, resume } from "../automation/pause.js";
import { makePolicy } from "../security/policy.js";
import { SkillIndex } from "../skills/index.js";
import { registerSkillTools } from "../skills/tools.js";
import { registerAcquireTools } from "../skills/acquire.js";
import { registerInstallTools } from "../skills/install.js";
import { llmAdvisory } from "../skills/repoanalyzer.js";
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
  // Capability audit (CF3, safe half): infer a task's needed skills, report present-vs-missing + an
  // acquisition plan. Read-only — discovery/security-vet/gated-install are the next phase. toolText is a
  // live getter so the audit sees every tool registered below.
  registerAcquireTools(tools, skills, () => tools.schemas().map((s) => `${s.name}: ${s.description}`).join("  "));
  const usage = usageLog(config);
  // Deterministic record/replay: VISHU_REPLAY=record|replay funnels through the Router chokepoint.
  const replayMode = (process.env.VISHU_REPLAY as ReplayMode) || "off";
  const cassette = new Cassette(join(config.paths.workspaceDir, "cassette.json"), replayMode);
  if (replayMode !== "off") process.stdout.write(`[replay] ${replayMode} → ${join(config.paths.workspaceDir, "cassette.json")}\n`);
  // Multi-provider pool: when named providers are configured, span them all in one Router (each bound to
  // its own model). VISHU_KEY_MODE decides parallel (balance) vs one-after-other (failover).
  const pooled = Object.keys(config.providers).length > 0;
  const router = pooled ? buildPoolRouter(config.providers, usage, cassette) : buildRouter(config.provider, usage, cassette);
  if (pooled) process.stdout.write(`[pool] ${Object.keys(config.providers).join(" + ")} (mode: ${process.env.VISHU_KEY_MODE || "failover"})\n`);
  const roles = buildRoles(router, config.provider.model, config.providers, config.roles, usage);
  // Expert/"builder" work runs on the largest NIM model (decision 2026-07-10). A dedicated builder
  // provider (config.roles.builder) keeps its own model unless JARVIS_BUILDER_MODEL overrides.
  const builderModel = resolveBuilderModel(process.env, config.provider);
  if (process.env.JARVIS_BUILDER_MODEL || !config.roles.builder) roles.assign("builder", roles.for("builder"), builderModel);
  if (roles.roles().length) process.stdout.write(`[roles] ${roles.roles().map((r) => `${r}→${config.roles[r] ?? "default"}@${roles.modelFor(r)}`).join(", ")}\n`);
  // CF3b paths 2+3: gated npm/pip + GitHub-repo acquisition (change_setting). The optional advisor is an
  // advisory-only LLM pass on a clean clone (builder model) — never changes the deterministic block verdict.
  registerInstallTools(tools, (dir) => llmAdvisory(router, builderModel, dir));
  const memory = new MemoryStore(
    config.paths.vaultDir,
    config.paths.memoryDbFile,
    join(config.paths.workspaceDir, "memory-events.log"),
    router.canEmbed() ? (texts) => router.embed(texts) : undefined,
  );
  registerMemoryTools(tools, memory);
  registerMemory(registry, memory);
  registerUsage(registry, config.paths.workspaceDir);
  registerReasoningTools(tools, { router, model: config.provider.model });
  registerReasoning(registry, { router, model: config.provider.model });
  registerReplay(registry, cassette);
  // Read-only config summary for the UI's provider/model switcher + settings panel.
  registry.register("vishu.config_summary", () =>
    okRpc({
      provider: config.provider.type,
      model: config.provider.model,
      keyMode: process.env.VISHU_KEY_MODE || "failover",
      pool: Object.keys(config.providers),
      presets: providerPresets(),
    }),
  );
  registerEvalRpc(registry, { router, model: config.provider.model, historyFile: join(config.paths.workspaceDir, "eval-history.jsonl") });
  const sessions = new SessionStore();
  const twin = new DigitalTwin(join(config.paths.workspaceDir, "twin.json"));
  const profile = new IdentityProfile(join(config.paths.workspaceDir, "profile.json"));
  // F0 approval channel: one terminal y/N prompt per gated action, shared across every turn so prompts
  // serialize on one stdin. No TTY (detached) → denies, keeping the fail-closed guarantee for send/spend/delete.
  const ask = makeAsk(terminalPrompt);
  // Durable append-only decision log — every gate verdict lands here across runs (UPGRADES §2).
  const audit = new AuditLog();
  // ask_once remembers persist here so a remembered "yes" survives restart (UPGRADES §1).
  const rememberFile = join(config.paths.workspaceDir, "approvals.json");
  // Daily send-cap counter (PLAN F7 ≤30/day; VISHU_SEND_CAP overrides), persisted across restarts.
  const sendCapFile = join(config.paths.workspaceDir, "send-count.json");
  const sendCap = Number(process.env.VISHU_SEND_CAP) || 30;
  // Agent factory + orchestration tools: registered here (not earlier) so the factory shares the same
  // `ask`/`audit` gate. `create_agent` gates registration; approved agents persist in agents.json and
  // become routable by the `dispatch` tool (Phase 1 Step 5 loop closure).
  const factory = new AgentFactory(tools, skills, { ask, audit, storePath: join(config.paths.workspaceDir, "agents.json") });
  registerOrchestrationTools(tools, { roles, model: config.provider.model, factory });
  // F12 personas/modes: one ModeManager sharing the runtime ask/audit gate. mode_propose gates NEW modes
  // (change_setting); approved ones persist to modes.json + hot-load. The active mode's prompt layers
  // into the agent's system prompt (below), so a switch actually changes behaviour.
  const modes = new ModeManager({ ask, audit, storePath: join(config.paths.workspaceDir, "modes.json") });
  registerModeTools(tools, modes);
  // Boot invariants (UPGRADES §5): never come up ungated, unlogged, or unable to pause. Fail loud.
  assertBoot(selfCheck({ gateWired: Boolean(ask) }), (s) => process.stdout.write(s));
  const agentService = new AgentService({
    router,
    tools,
    policy: makePolicy("full", config.paths.actionDir),
    terminal: new Terminal(config.paths.actionDir),
    model: config.provider.model,
    runLog: new RunLog(),
    twin,
    profile,
    mode: modes,
    ask,
    audit,
    rememberFile,
    sendCapFile,
    sendCap,
  }, sessions);
  registerAgent(registry, agentService);

  // Agent-level task queue: fire-and-poll multitasking, N turns at once (VISHU_AGENT_CONCURRENCY, default 2).
  // Each task gets its own Terminal so concurrent shells don't interleave; the session store is shared.
  const agentConcurrency = Number(process.env.VISHU_AGENT_CONCURRENCY) || 2;
  const agentQueue = new AgentQueue(async (sid, msg) => {
    const terminal = new Terminal(config.paths.actionDir);
    try {
      const svc = new AgentService(
        { router, tools, policy: makePolicy("full", config.paths.actionDir), terminal, model: config.provider.model, runLog: new RunLog(), twin, profile, mode: modes, ask, audit, rememberFile, sendCapFile, sendCap },
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
  registerAutofix(registry, {
    actionDir: config.paths.actionDir,
    autonomy: "automatic",
    runAgent: async (prompt) => (await agentService.startTurn(undefined, prompt)).final,
    bus,
  });
  triggers.start();

  // Phase 13: self-evolving loop — scan the action dir for cheap improvements on a daily cron and
  // record them as suggest-only proposals (never auto-applied). Reachable over vishu.evolve_*.
  const evolver = new ProjectEvolver(join(config.paths.workspaceDir, "evolve.json"));
  registerEvolve(registry, evolver, workflows);
  registerTwin(registry, twin, workflows);
  registerProfile(registry, profile, twin);
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

  // Phase 1 Step 3: attach external domain services (JobAutomation, …) from jarvis.domains.json as
  // namespaced `<id>__*` tool sets, each domain's declared action classes reaching the F0 gate.
  const domainsFile = process.env.VISHU_DOMAINS_FILE || join(process.cwd(), "jarvis.domains.json");
  const domainTools = await new DomainManager(loadDomains(domainsFile), tools, { bus, sampler }).start();
  if (domainTools.length) process.stdout.write(`[domains] ${domainTools.length} tool(s): ${domainTools.join(", ")}\n`);

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
  // UPGRADES §5: an out-of-band instant pause — hit it mid-runaway without the agent's cooperation.
  // Ctrl+Break on Windows (SIGINT/Ctrl+C still stops); SIGUSR2 on POSIX (`kill -USR2 <pid>`).
  const pauseSignal: NodeJS.Signals = process.platform === "win32" ? "SIGBREAK" : "SIGUSR2";
  process.on(pauseSignal, () => {
    pause(`${pauseSignal} kill switch`);
    process.stdout.write(`\n[pause] engaged via ${pauseSignal} — every gated action now denied; \`vishu resume\` to clear\n`);
  });
  process.stdout.write(`[serve] instant pause: ${pauseSignal === "SIGBREAK" ? "Ctrl+Break" : "kill -USR2 " + process.pid}\n`);
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
  const model = resolveBuilderModel(process.env, config.provider); // expert build runs on the builder model
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

/** Long-horizon eval harness: run the built-in suite against a runner, print a scorecard + trend, and
 * append the run to history so quality is tracked over time. Runners: baseline | effort | moa. */
async function evalCmd(runnerName = "effort"): Promise<number> {
  const config = loadConfig();
  const router = buildRouter(config.provider, usageLog(config));
  const runners = makeRunners(router, config.provider.model);
  const runner = runners[runnerName];
  if (!runner) return usageErr(`vishu eval [${Object.keys(runners).join("|")}]`);
  // VISHU_EVAL_CONCURRENCY=1 runs tasks sequentially — gentler on a single key's rate limit (MoA fans out).
  const concurrency = Number(process.env.VISHU_EVAL_CONCURRENCY) || undefined;
  const report = await runEval(BUILTIN_SUITE, runner, { runnerName, concurrency });
  const history = new EvalHistory(join(config.paths.workspaceDir, "eval-history.jsonl"));
  history.record(report);
  process.stdout.write(`${renderEval(report, history.trend(runnerName))}\n`);
  return 0;
}

/** SWE-bench Lite: generate patches and write a predictions.jsonl the official harness scores. Vishu's
 * half is patch generation; the FAIL_TO_PASS / Docker scoring delegates to `swebench` (printed at the end)
 * — never reimplement the scorer, that's where homegrown harnesses produce bogus numbers.
 *   vishu eval swebench [--limit N] [--file local.json] [--out preds.jsonl] */
async function sweBenchCmd(args: string[]): Promise<number> {
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const config = loadConfig();
  const cacheDir = join(config.paths.workspaceDir, "swebench");
  mkdirSync(cacheDir, { recursive: true });
  const out = flag("--out") ?? join(cacheDir, "predictions.jsonl");
  const limit = flag("--limit") ? Number(flag("--limit")) : undefined;
  const model = config.provider.model;
  const router = buildRouter(config.provider, usageLog(config));

  const instances = await loadSweBenchLite({ file: flag("--file"), limit, cacheFile: join(cacheDir, "lite.json") });
  process.stdout.write(`[swebench] ${instances.length} instances · model ${model} → ${out}\n`);

  const runAgent = async (repoDir: string, problem: string): Promise<void> => {
    const registry = registerBuiltins(new ToolRegistry());
    const terminal = new Terminal(repoDir);
    try {
      await runToolLoop(
        { router, registry, policy: makePolicy("full", repoDir), terminal, model },
        [
          { role: "system", content: "You are Vishu, a coding agent fixing a reported issue in an existing repository. Read the relevant code, then edit files in place to resolve the issue. Make the smallest change that fixes it; do not add dependencies or unrelated changes." },
          { role: "user", content: problem },
        ],
      );
    } finally {
      terminal.close();
    }
  };

  await runSweBench(instances, model, { runAgent, cacheDir }, {
    outFile: out,
    onProgress: (id, i, n) => process.stdout.write(`[swebench] ${i}/${n} ${id}\n`),
  });

  process.stdout.write(
    `\n[swebench] wrote ${out}\n` +
      "[swebench] score it with the official harness (needs Docker + Python):\n" +
      "  pip install swebench\n" +
      "  python -m swebench.harness.run_evaluation \\\n" +
      "    --dataset_name princeton-nlp/SWE-bench_Lite \\\n" +
      `    --predictions_path ${out} \\\n` +
      "    --max_workers 4 --run_id vishu\n",
  );
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
  // Load a .env from the working dir if present (Node 24 native, no dep). Absent → use the real env.
  try {
    process.loadEnvFile();
  } catch {
    /* no .env file — fall back to the ambient environment */
  }
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
  if (cmd === "jarvis") return serve(); // the full PA runtime: serve + domain services from jarvis.domains.json
  if (cmd === "pause") {
    // Flag-file kill switch — works out-of-band whether or not a core is running (survives restart).
    pause(argv.slice(1).join(" "));
    process.stdout.write(`[pause] engaged → ${pauseFile()}\n`);
    return 0;
  }
  if (cmd === "resume") {
    resume();
    process.stdout.write(`[resume] cleared${isPaused() ? " (still paused: another PAUSED file?)" : ""}\n`);
    return 0;
  }
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
  if (cmd === "eval") return argv[1] === "swebench" ? sweBenchCmd(argv.slice(2)) : evalCmd(argv[1]);
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
      "  vishu jarvis                 start the full PA runtime (serve + domain services)",
      "  vishu pause [reason]         engage the global kill switch (denies all gated actions)",
      "  vishu resume                 clear the global pause",
      "  vishu chat <message>         one-shot chat via the configured provider",
      "  vishu agent <task>           run the tool loop (build/run inside action_dir)",
      "  vishu build <what>           guided secure app builder: spec interview → build → pentest",
      "  vishu report [days]          weekly token report: where tokens go + where they're wasted",
      "  vishu eval [runner]          run the eval suite (baseline|effort|moa) + track quality over time",
      "  vishu eval swebench [--limit N] [--file f] [--out p]   SWE-bench Lite: write predictions.jsonl",
      "  vishu rpc <method> [json]    call a method on a running core",
      "",
    ].join("\n"),
  );
  return cmd && cmd !== "help" && cmd !== "--help" ? 1 : 0;
}

// Set exitCode and let the event loop drain (handles are unref'd) instead of an abrupt process.exit()
// that races with socket/stdout teardown — the latter trips a libuv UV_HANDLE_CLOSING assertion on
// Windows when a command errors (e.g. a provider 429). A thrown error becomes one clean line, not a crash.
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`[vishu] ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
