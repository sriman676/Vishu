import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { registerAgent, registerAgentQueue } from "../agent/rpc.js";
import { AgentQueue } from "../agent/queue.js";
import { SessionStore } from "../agent/session.js";
import { buildApp, writeBuildArtifacts } from "../appbuilder/build.js";
import { formatFindings } from "../appbuilder/security.js";
import { type AppSpec, type InterviewTurn, interviewStep, persistSpec, specToMarkdown } from "../appbuilder/spec.js";
import { AgentService } from "../agent/service.js";
import { loadConfig, nimStateFile, providerPresets, resolveBuilderModel } from "../config/config.js";
import { loadNimState, refreshNimModels } from "../providers/nimrefresh.js";
import { type DiscoveredProvider, discoverProviders, keysHealthFile } from "../providers/registry.js";
import { ok as okRpc } from "../transport/rpc.js";
import { registerAutomation, registerAutofix } from "../automation/rpc.js";
import { SchedulerGate } from "../automation/gate.js";
import { attachNotificationSink } from "../automation/notify.js";
import { startResourceGuard } from "../automation/sensor.js";
import { TriggerManager, TriggerStore } from "../automation/triggers.js";
import { RunStore } from "../automation/runs.js";
import { WorkflowStore } from "../automation/workflows.js";
import { registerConnectors } from "../connectors/rpc.js";
import { registerMeeting } from "../connectors/meeting.js";
import { LocalConnector } from "../connectors/local.js";
import { McpClient, type McpSampler, registerMcpTools } from "../connectors/mcp.js";
import { DomainManager, KNOWN_MCP, type DomainConfig, loadDomains, resolveConnect, upsertDomain } from "../connectors/domains.js";
import { authPlan } from "../connectors/composio-auth.js";
import { spawnSync } from "node:child_process";
import { loadRepoAdapters, registerAdapterTools, toDomainConfigs } from "../connectors/repoadapter.js";
import { WebhookConnector } from "../connectors/webhook.js";
import { StubMailConnector } from "../connectors/daily.js";
import { GmailConnector } from "../connectors/gmail.js";
import { folderSource, gmailSource, startSync } from "../connectors/sync.js";
import { tokenChannels } from "../connectors/channels.js";
import type { Connector } from "../connectors/types.js";
import { registerMemory } from "../memory/rpc.js";
import { MODULES } from "../modules/all.js";
import { loadModules } from "../modules/registry.js";
import { MemoryStore } from "../memory/store.js";
import { learnFromTurn } from "../memory/autolearn.js";
import { registerMemoryTools } from "../memory/tools.js";
import { ProjectEvolver, runEvolutionPass } from "../personalization/evolve.js";
import { DigitalTwin } from "../personalization/twin.js";
import { AchievementStore } from "../career/achievements.js";
import { parseGithubProjects, assembleResumeMarkdown } from "../career/resume.js";
import { contactSource, guessEmails, parseContacts } from "../career/osint.js";
import { scoreResume } from "../career/score.js";
import { parseJobPosting, generateCoverLetter, type JobPosting } from "../career/generate.js";
import { buildColdMail, renderDraft } from "../career/draft.js";
import { registerCareer } from "../career/rpc.js";
import { imageToDataUrl } from "../modules/vision.js";
import { IdentityProfile } from "../personalization/profile.js";
import { critiquePrompts, critiquePromptsCouncil } from "../personalization/critique.js";
import { registerEvolve, registerProfile, registerTwin } from "../personalization/rpc.js";
import { registerOrchestrationTools } from "../orchestration/tools.js";
import { AgentFactory } from "../orchestration/factory.js";
import { ModeManager, registerModeRpc, registerModeTools } from "../orchestration/modes.js";
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
import { buildPoolRouter, buildRouter, visionProvider } from "../providers/factory.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OpenAICompatibleProvider } from "../providers/openai.js";
import { ProviderError } from "../providers/types.js";
import { RunLog } from "../reliability/runlog.js";
import { makeAsk, terminalPrompt } from "../reliability/ask.js";
import { AuditLog } from "../security/audit.js";
import { registerAudit } from "../security/rpc.js";
import { assertBoot, selfCheck } from "../reliability/selfcheck.js";
import { DecisionStore, registerDecisions } from "../reliability/autonomy.js";
import { ApprovalGate } from "../reliability/approvals.js";
import { buildVishuMcpServer, serveMcpHttp, serveMcpStdio } from "../connectors/mcp-server.js";
import type { ToolContext } from "../tools/types.js";
import { isPaused, pause, pauseFile, resume } from "../automation/pause.js";
import { makePolicy } from "../security/policy.js";
import { SkillIndex } from "../skills/index.js";
import { registerSkillTools } from "../skills/tools.js";
import { registerAcquireTools } from "../skills/acquire.js";
import { registerInstallTools } from "../skills/install.js";
import { analyzeRepo, applyTrust, isTrustedRepo, llmAdvisory, renderAnalysis, setRepoTrust, trustedRepoPaths } from "../skills/repoanalyzer.js";
import { registerBuiltins } from "../tools/builtins.js";
import { runToolLoop } from "../tools/loop.js";
import { ToolRegistry } from "../tools/registry.js";
import { sandboxedTerminal } from "../tools/terminal.js";
import { initToken } from "../transport/auth.js";
import { registerUsage } from "../usage/rpc.js";
import { registerDashboard } from "../dashboard/rpc.js";
import { watchActivity } from "../dashboard/dashboard.js";
import { BudgetWatcher } from "../usage/budget.js";
import { UsageLog, readUsage } from "../usage/log.js";
import { buildReport, renderReport } from "../usage/report.js";
import { ledgerReport, readLedger, renderLedger } from "../usage/ledger.js";
import { TraceLog, Tracer, readSpans } from "../reliability/trace.js";
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

/** `vishu connect <name>` — fold a downstream MCP into jarvis.domains.json so it auto-mounts (gated)
 * next `vishu jarvis`. `<name>` from the curated KNOWN_MCP, or any custom server via `--cmd`/`--args`.
 * `--list` shows what's connectable and what's already mounted. This is the single "connect to X" seam. */
function connectCmd(argv: string[]): number {
  const domainsFile = process.env.VISHU_DOMAINS_FILE || join(process.cwd(), "jarvis.domains.json");
  const current = loadDomains(domainsFile);
  const name = argv.find((a) => !a.startsWith("--"));
  if (argv[0] === "--list" || !name) {
    process.stdout.write(`known:   ${Object.keys(KNOWN_MCP).join(", ")}\n`);
    process.stdout.write(current.length ? `mounted: ${current.map((d) => d.id).join(", ")}\n` : "mounted: (none)\n");
    return 0;
  }
  const flag = (f: string): string | undefined => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const cmdOv = flag("--cmd");
  // Dynamic resolve: curated name → its MCP; --cmd → any custom MCP; anything else → the universal
  // Composio mount (1000+ apps, one key, no per-app package/lag) instead of erroring. "Say an app, it connects."
  const composioFallback = !KNOWN_MCP[name] && !cmdOv;
  let cfg: DomainConfig;
  if (cmdOv) {
    const known = KNOWN_MCP[name];
    cfg = known ? { ...known, cmd: cmdOv } : { id: name, cmd: cmdOv };
  } else cfg = resolveConnect(name).cfg;
  const argsOv = flag("--args");
  if (argsOv) {
    try {
      cfg.args = JSON.parse(argsOv) as string[];
    } catch {
      return usageErr("--args must be a JSON array, e.g. --args '[\"-m\",\"server\"]'");
    }
  }
  const cwdOv = flag("--cwd");
  if (cwdOv) cfg.cwd = resolve(cwdOv);
  writeFileSync(domainsFile, `${JSON.stringify({ domains: upsertDomain(current, cfg) }, null, 2)}\n`);
  // Keyless-connect smoothing: `--auth` on a Composio-routed app launches the hosted OAuth handshake
  // (print URL → wait for ACTIVE) so "connect X" is turnkey; degrades to the manual hint otherwise.
  const viaComposio = composioFallback || name === "composio";
  const plan = authPlan(name, argv.includes("--auth"), viaComposio);
  const note = plan.run
    ? ""
    : plan.note
      ? `\n${plan.note}`
      : composioFallback
        ? `\n"${name}" routes through Composio — set COMPOSIO_API_KEY and authorize ${name} there; its tools appear as composio__*.`
        : "";
  process.stdout.write(
    `connected ${cfg.id} -> ${domainsFile}\nmounts on next 'vishu jarvis'${cfg.requireEnv ? ` (set ${cfg.requireEnv} first)` : ""}${note}\n`,
  );
  if (plan.run) {
    const r = spawnSync("py", [join(process.cwd(), "scripts", "composio-connect.py"), name], { stdio: "inherit" });
    if (r.error) {
      process.stderr.write(`could not launch Python (py): ${r.error.message}\n`);
      return 1;
    }
    return r.status ?? 1;
  }
  return 0;
}

/** `vishu models refresh` — probe the live NIM catalogue, keep only models that actually answer, rank by
 * params, and persist the best-available builder + fallback chain (read by config at next start). Wire it
 * to a weekly trigger (or a Windows scheduled task) so the PA auto-promotes to the top model NIM serves. */
async function modelsCmd(argv: string[]): Promise<number> {
  const key = process.env.NVIDIA_API_KEY || (process.env.VISHU_API_KEY?.startsWith("nvapi-") ? process.env.VISHU_API_KEY : "");
  if (!key) return usageErr("vishu models refresh needs a NIM key (NVIDIA_API_KEY or VISHU_API_KEY = nvapi-…)");
  if (argv[0] && argv[0] !== "refresh") return usageErr("vishu models refresh");
  const file = nimStateFile();
  process.stdout.write("probing NIM catalogue for the best available models…\n");
  const s = await refreshNimModels(key, file);
  process.stdout.write(`builder:   ${s.builder}\nfallbacks: ${s.fallbacks.join(", ")}\nwritten -> ${file}\n`);
  return 0;
}

/** True liveness probe: a real 1-token chat with the provider's CONFIGURED model — the only test that
 * reflects what PA actually calls (a valid key whose default model 404s, or an unfunded 402 account, is
 * useless to PA and reads dead). Returns true = answered; false = definitively unusable (401/402/404/400);
 * undefined = inconclusive (429/5xx transient, or local) → left in the pool. A /models check can't see
 * credit/model-access, so it wrongly passed unfunded and wrong-model keys — this doesn't. */
async function probeProvider(cfg: DiscoveredProvider["cfg"]): Promise<boolean | undefined> {
  if (cfg.type === "ollama") return undefined; // on-device; assumed up, no network probe
  const apiKey = cfg.apiKeys[0];
  if (!apiKey) return undefined;
  const prov =
    cfg.type === "anthropic"
      ? new AnthropicProvider({ name: "probe", baseUrl: cfg.baseUrl, apiKey })
      : new OpenAICompatibleProvider({ name: "probe", baseUrl: cfg.baseUrl, apiKey });
  try {
    await prov.chat({ model: cfg.model, messages: [{ role: "user", content: "hi" }], maxTokens: 1, category: "probe" });
    return true;
  } catch (e) {
    return e instanceof ProviderError && e.transient ? undefined : false; // transient → keep; else dead
  }
}

/** `vishu keys` — show the assigner's pool: every provider key discovered in the env, its tier, model, key
 * count, and which roles it's assigned. `vishu keys --probe` pings each and writes keys-health.json so dead
 * keys drop out of routing. This is the visible surface of the deterministic key assigner. */
async function keysCmd(argv: string[]): Promise<number> {
  if (argv[0] && argv[0] !== "--probe") return usageErr("vishu keys [--probe]");
  const config = loadConfig();
  const list = discoverProviders();
  if (!list.length) {
    process.stdout.write("no provider keys found. add one to the workspace .env (e.g. MINIMAX_API_KEY=…) and PA will use it.\n");
    return 0;
  }
  const rolesFor = (name: string) => Object.entries(config.roles).filter(([, p]) => p === name).map(([r]) => r);

  if (argv[0] === "--probe") {
    process.stdout.write("probing providers for liveness…\n");
    const providers: Record<string, { ok: boolean; ts: string }> = {};
    for (const p of list) {
      const ok = await probeProvider(p.cfg);
      process.stdout.write(`  ${p.name.padEnd(12)} ${ok === true ? "alive" : ok === false ? "DEAD" : "skip"}\n`);
      if (ok !== undefined) providers[p.name] = { ok, ts: new Date().toISOString() };
    }
    const file = keysHealthFile();
    writeFileSync(file, JSON.stringify({ providers }, null, 2));
    process.stdout.write(`written -> ${file}\n`);
    return 0;
  }

  process.stdout.write(`${list.length} provider(s) available, best-first:\n`);
  for (const p of list) {
    const roles = rolesFor(p.name);
    const keys = `${p.keyCount} key${p.keyCount === 1 ? "" : "s"}`;
    process.stdout.write(`  ${p.name.padEnd(12)} ${p.tier.padEnd(8)} ${keys.padEnd(7)} ${p.cfg.model}${roles.length ? `  → ${roles.join(", ")}` : ""}\n`);
  }
  process.stdout.write("run `vishu keys --probe` to health-check and drop dead keys from routing.\n");
  return 0;
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

/** Weekly best-available NIM auto-update: on boot, if the persisted chain is missing or >7 days old,
 * re-probe the catalogue and pick the top models NIM actually serves. Staleness-gated (cheap when fresh),
 * best-effort (a failed probe keeps the last good chain). The always-on host restart-loop makes "weekly"
 * real without a separate scheduler. Runs before loadConfig so the fresh chain feeds this boot. */
async function maybeRefreshNimWeekly(): Promise<void> {
  const key = process.env.NVIDIA_API_KEY || (process.env.VISHU_API_KEY?.startsWith("nvapi-") ? process.env.VISHU_API_KEY : "");
  if (!key) return;
  const file = nimStateFile();
  const st = loadNimState(file);
  if (st && Date.now() - st.ts < 7 * 24 * 60 * 60 * 1000) return; // fresh enough
  try {
    const s = await refreshNimModels(key, file);
    process.stdout.write(`[models] weekly NIM refresh → builder=${s.builder}\n`);
  } catch {
    /* best-effort — keep the last good chain */
  }
}

async function serve(): Promise<number> {
  await maybeRefreshNimWeekly();
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
  const tracer = new Tracer(new TraceLog(join(config.paths.workspaceDir, "spans.jsonl"))); // PAUL span tracing → ledger latency
  const router = pooled ? buildPoolRouter(config.providers, usage, cassette, tracer) : buildRouter(config.provider, usage, cassette, tracer);
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
  registerMemory(registry, memory);
  registerUsage(registry, config.paths.workspaceDir);
  registerDashboard(registry, config.paths); // §9 "visualize" — read-only data-map + activity feed
  // §9 live push: an activity-log change publishes a bus event (forwarded over SSE) so the UI refreshes now.
  watchActivity(config.paths.workspaceDir, () => bus.publish({ domain: "dashboard", type: "changed", payload: {} }));
  registerAudit(registry); // vishu.audit_verify — tamper-check the hash-chained decision log (default file)
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
  // Cold-apply pipeline S0: timestamped achievements the user adds by conversation/typing; resume-gen
  // reads them later. Zero external dep — the one pipeline brick that works before any MCP is connected.
  const achievements = new AchievementStore(join(config.paths.workspaceDir, "achievements.json"));
  tools.register({
    name: "career_achievement_add",
    meta: { action: "write" },
    description: "Record a career achievement (timestamped now). Use #tags to group it (e.g. #backend). Feeds resume/cover-letter generation.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: async (a) => {
      const saved = achievements.add(String(a.text ?? ""));
      return saved ? `recorded (${saved.at.slice(0, 10)})${saved.tags.length ? ` [${saved.tags.join(", ")}]` : ""}` : "skipped (blank or duplicate)";
    },
  });
  tools.register({
    name: "career_achievements",
    meta: { action: "read" },
    description: "List recorded achievements, newest first. Optional `tag` filter.",
    parameters: { type: "object", properties: { tag: { type: "string" } } },
    run: async (a) => {
      const items = achievements.list(a.tag ? String(a.tag) : undefined);
      return items.length ? items.map((x) => `- ${x.at.slice(0, 10)} — ${x.text}`).join("\n") : "no achievements recorded yet";
    },
  });
  // S1 resume assembler: profile + achievements + GitHub projects → resume markdown. The agent fetches
  // repos via a mounted GitHub MCP and passes the raw JSON as `projectsJson`; this parses + assembles.
  tools.register({
    name: "resume_build",
    meta: { action: "read" },
    description: "Assemble a resume (markdown) from the identity profile + recorded achievements + GitHub projects. Pass the raw GitHub repos JSON (from a GitHub MCP) as `projectsJson` to include projects.",
    parameters: { type: "object", properties: { projectsJson: { type: "string" } } },
    run: async (a) =>
      assembleResumeMarkdown({
        profile: profile.render(),
        achievements: achievements.list(),
        projects: a.projectsJson ? parseGithubProjects(String(a.projectsJson)) : [],
      }),
  });
  // S4 OSINT contact seam: parse a contact-lookup response (Apollo/Hunter/web JSON via `lookupJson`) and
  // seed likely HR emails from names + `domain`. Pluggable source; free web lane by default (no key needed).
  tools.register({
    name: "osint_contacts",
    meta: { action: "read" },
    description: "Find company/HR contacts for outreach. Pass a contact-lookup response as `lookupJson` (from an Apollo/Hunter/web MCP) and/or a company `domain` to guess likely emails. Returns contacts + the active source.",
    parameters: { type: "object", properties: { company: { type: "string" }, domain: { type: "string" }, lookupJson: { type: "string" } }, required: ["company"] },
    run: async (a) => {
      const source = contactSource();
      const contacts = a.lookupJson ? parseContacts(String(a.lookupJson), source) : [];
      const domain = a.domain ? String(a.domain) : undefined;
      const lines = contacts.map((c) => {
        const guesses = !c.email && c.name && domain ? ` — guesses: ${guessEmails(c.name, domain).slice(0, 3).join(", ")}` : "";
        return `- ${[c.name, c.role, c.email].filter(Boolean).join(" · ") || "(unnamed)"}${guesses}`;
      });
      return `source: ${source}\n${lines.length ? lines.join("\n") : `no contacts parsed for ${String(a.company)}${domain ? ` — try email patterns at ${domain}` : ""}`}`;
    },
  });
  // S2 scoring loop: score a resume with the local hiring-agent evaluator (scorer, not generator) and
  // return category scores + areas to improve. Passthrough to resume_audit_cli.py; degrades gracefully.
  tools.register({
    name: "resume_score",
    meta: { action: "read" },
    description: "Score a resume with the local hiring-agent evaluator (category scores + areas to improve). Pass `resumeMarkdown` (e.g. from resume_build) or a `resumePath`. Needs VISHU_HIRING_AGENT_DIR + hiring-agent's own LLM env.",
    parameters: { type: "object", properties: { resumeMarkdown: { type: "string" }, resumePath: { type: "string" }, model: { type: "string" } } },
    run: async (a) =>
      scoreResume({
        hiringDir: process.env.VISHU_HIRING_AGENT_DIR,
        python: process.env.VISHU_PYTHON,
        resumeMarkdown: a.resumeMarkdown ? String(a.resumeMarkdown) : undefined,
        resumePath: a.resumePath ? String(a.resumePath) : undefined,
        model: a.model ? String(a.model) : undefined,
      }),
  });
  // Career LLM lane: one small completion helper for the generation steps (job parse, cover letter).
  const careerLLM = (temperature: number, maxTokens: number) => async (system: string, user: string) => {
    const res = await router.chat({
      model: config.provider.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      maxTokens,
      category: "career",
    });
    return res.content;
  };
  // Multimodal: describe/answer about a local image or image URL via a vision model. Routes to
  // VISHU_VISION_MODEL (fall back to the main model — degrades to text-only if it lacks vision).
  tools.register({
    name: "see_image",
    meta: { action: "read" },
    description: "Look at an image (local file path or http(s)/data: URL) and answer a question about it. Needs a vision-capable model on VISHU_VISION_MODEL (else falls back to the main model).",
    parameters: { type: "object", properties: { path: { type: "string" }, prompt: { type: "string" } }, required: ["path"] },
    run: async (a) => {
      let url: string;
      try {
        url = imageToDataUrl(String(a.path ?? ""));
      } catch (e) {
        return `could not read image: ${(e as Error).message}`;
      }
      // Vision goes straight to the local Ollama vision model — the pooled router would 400 on a cloud
      // key or force-bind the text-only local model. Falls back to router.chat (text-only degrade) when
      // no local vision endpoint is configured.
      const req = {
        model: process.env.VISHU_VISION_MODEL ?? config.provider.model,
        messages: [{ role: "user" as const, content: a.prompt ? String(a.prompt) : "Describe this image.", images: [url] }],
        temperature: 0,
        maxTokens: 700,
        category: "vision" as const,
      };
      const res = await (visionProvider()?.chat(req) ?? router.chat(req));
      return res.content;
    },
  });
  // S3 (manual intake): structure a pasted job posting into {title, company, domain, description}.
  tools.register({
    name: "job_parse",
    meta: { action: "read" },
    description: "Structure a pasted job posting (raw text or fetched page) into JSON {title, company, domain, description}. Feeds cover_letter_generate + osint_contacts.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: async (a) => {
      const job = await parseJobPosting(careerLLM(0, 700), String(a.text ?? ""));
      return job ? JSON.stringify(job) : "could not parse a job posting from that text";
    },
  });
  // S2 (generation): draft a tailored cover letter from the resume + parsed job (+ optional contact name).
  tools.register({
    name: "cover_letter_generate",
    meta: { action: "read" },
    description: "Draft a tailored cover letter. Pass `resumeMarkdown` (from resume_build) and `jobJson` (from job_parse); optional `contactName`.",
    parameters: { type: "object", properties: { resumeMarkdown: { type: "string" }, jobJson: { type: "string" }, contactName: { type: "string" } }, required: ["resumeMarkdown", "jobJson"] },
    run: async (a) => {
      let job: JobPosting;
      try {
        job = JSON.parse(String(a.jobJson)) as JobPosting;
      } catch {
        return "jobJson is not valid JSON — pass the output of job_parse";
      }
      return generateCoverLetter(careerLLM(0.4, 900), {
        resumeMarkdown: String(a.resumeMarkdown ?? ""),
        job,
        contactName: a.contactName ? String(a.contactName) : undefined,
      });
    },
  });
  // S5 (draft only): assemble a cold-outreach email into the workspace outbox for review. NEVER sends —
  // sending stays the existing send-class GmailConnector path, explicitly approved by the user.
  tools.register({
    name: "coldmail_draft",
    meta: { action: "write" },
    description: "Assemble a cold-outreach email (cover letter + job + contact) and save it to the outbox for review. Draft only — does NOT send.",
    parameters: {
      type: "object",
      properties: { coverLetter: { type: "string" }, jobTitle: { type: "string" }, company: { type: "string" }, contactName: { type: "string" }, contactEmail: { type: "string" }, fromName: { type: "string" }, resumePath: { type: "string" } },
      required: ["coverLetter", "jobTitle", "company"],
    },
    run: async (a) => {
      const mail = buildColdMail({
        job: { title: String(a.jobTitle), company: String(a.company) },
        contact: { name: a.contactName ? String(a.contactName) : undefined, email: a.contactEmail ? String(a.contactEmail) : undefined },
        coverLetter: String(a.coverLetter ?? ""),
        fromName: a.fromName ? String(a.fromName) : undefined,
        resumePath: a.resumePath ? String(a.resumePath) : undefined,
      });
      const dir = join(config.paths.workspaceDir, "outbox");
      mkdirSync(dir, { recursive: true });
      const out = join(dir, `draft-${Date.now()}.txt`);
      writeFileSync(out, renderDraft(mail));
      return `draft saved (review before sending): ${out}\n\n${renderDraft(mail)}`;
    },
  });
  // S6: resume page RPC surface — assemble the resume + add/list achievements from the UI.
  registerCareer(registry, {
    achievements,
    buildResume: (projectsJson) =>
      assembleResumeMarkdown({
        profile: profile.render(),
        achievements: achievements.list(),
        projects: projectsJson ? parseGithubProjects(projectsJson) : [],
      }),
  });
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
  // Learned autonomy (Alfred ask→confirm→act): log every gate verdict; after N clean approvals of a
  // reversible signature, SUGGEST an auto-approve grant on the bus. Grants (RPC-only, floor-excluded)
  // are consulted before asking. VISHU_AUTONOMY_N overrides the default 3.
  const decisions = new DecisionStore(
    join(config.paths.workspaceDir, "decisions.jsonl"),
    join(config.paths.workspaceDir, "grants.json"),
    Number(process.env.VISHU_AUTONOMY_N) || 3,
  );
  const suggest = (actionClass: string, signature: string) =>
    bus.publish({ domain: "autonomy", type: "suggest_grant", payload: { actionClass, signature } });
  // Agent factory + orchestration tools: registered here (not earlier) so the factory shares the same
  // `ask`/`audit` gate. `create_agent` gates registration; approved agents persist in agents.json and
  // become routable by the `dispatch` tool (Phase 1 Step 5 loop closure).
  const factory = new AgentFactory(tools, skills, { ask, audit, storePath: join(config.paths.workspaceDir, "agents.json") });
  // F12 personas/modes: one ModeManager sharing the runtime ask/audit gate. mode_propose gates NEW modes
  // (change_setting); approved ones persist to modes.json + hot-load. The active mode's prompt layers
  // into the agent's system prompt (below), so a switch actually changes behaviour. Built before the
  // orchestration tools so `dispatch` can route a persona request to a mode switch (Phase-4 mode arm).
  const modes = new ModeManager({
    ask,
    audit,
    storePath: join(config.paths.workspaceDir, "modes.json"),
    // §8 auto-detect: surface a "propose a mode for this?" suggestion on the bus (never auto-activates).
    onSuggestMode: (need) => bus.publish({ domain: "modes", type: "suggest_mode", payload: { need } }),
  });
  registerOrchestrationTools(tools, { roles, model: config.provider.model, factory, modes });
  registerModeTools(tools, modes);
  registerModeRpc(registry, modes); // web UI persona switcher + per-mode voiceId (§8)
  // §8: scope agent memory write+recall to the active mode's folder (registered here — after `modes` exists).
  registerMemoryTools(tools, memory, () => modes.active().memoryFolder);
  // Boot invariants (UPGRADES §5): never come up ungated, unlogged, or unable to pause. Fail loud.
  assertBoot(selfCheck({ gateWired: Boolean(ask) }), (s) => process.stdout.write(s));
  const agentService = new AgentService({
    router,
    tools,
    policy: makePolicy("full", config.paths.actionDir),
    terminal: sandboxedTerminal(config.paths.actionDir),
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
    decisions,
    suggest,
    // Automatic memory: extract a durable user fact post-turn on the cheap classifier lane, file it
    // under "core". Fire-and-forget in the service, so latency/faults never touch the reply.
    learn: (message) =>
      learnFromTurn(
        memory,
        async (system, user) => {
          const res = await roles.for("classifier").chat({
            model: roles.modelFor("classifier") ?? config.provider.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature: 0,
            maxTokens: 120,
            category: "memory",
          });
          return res.content;
        },
        message,
      ),
    // Learned proactivity: when a task recurs enough, surface a suggest-only nudge to schedule it. The
    // user/UI accepts via the existing twin.accept + trigger path — this only surfaces the suggestion.
    suggestTask: (task) => bus.publish({ domain: "proactivity", type: "suggest_schedule", payload: { task } }),
  }, sessions);
  registerAgent(registry, agentService);
  registerDecisions(registry, decisions); // vishu.decisions_list / autonomy_grant / autonomy_revoke

  // Agent-level task queue: fire-and-poll multitasking, N turns at once (VISHU_AGENT_CONCURRENCY, default 2).
  // Each task gets its own Terminal so concurrent shells don't interleave; the session store is shared.
  const agentConcurrency = Number(process.env.VISHU_AGENT_CONCURRENCY) || 2;
  const agentQueue = new AgentQueue(async (sid, msg) => {
    const terminal = sandboxedTerminal(config.paths.actionDir);
    try {
      const svc = new AgentService(
        { router, tools, policy: makePolicy("full", config.paths.actionDir), terminal, model: config.provider.model, runLog: new RunLog(), twin, profile, mode: modes, ask, audit, rememberFile, sendCapFile, sendCap, decisions, suggest, tracer },
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
    // Durability: triggers persist + reload on restart; interrupted workflow runs resume per-step.
    triggerStore: new TriggerStore(join(config.paths.workspaceDir, "triggers.json")),
    runStore: new RunStore(join(config.paths.workspaceDir, "runs")),
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
  // Cross-LLM self-improvement (item 4): only when a distinct 'reviewer' AI is assigned (so the critique
  // is genuinely cross-model, not self-review). Manual-trigger over vishu.evolve_critique — never on a cron.
  // Council v2: assemble distinct models across the critic-capable roles so the critique is a
  // multi-model consensus, not self-review. With ≥2 distinct models we run the council; with one we
  // fall back to the original single-reviewer path. Still manual-trigger, still suggest-only.
  const councilSeen = new Set<string>();
  const council = [] as { model: string; provider: ReturnType<typeof roles.for> }[];
  for (const r of ["reviewer", "judge", "builder"]) {
    if (!roles.roles().includes(r)) continue;
    const model = roles.modelFor(r) ?? config.provider.model;
    if (councilSeen.has(model)) continue;
    councilSeen.add(model);
    council.push({ model, provider: roles.for(r) });
  }
  const critic =
    council.length >= 2
      ? () => critiquePromptsCouncil(council)
      : roles.roles().includes("reviewer")
        ? () => critiquePrompts(roles.for("reviewer"), roles.modelFor("reviewer") ?? config.provider.model)
        : undefined;
  registerEvolve(registry, evolver, workflows, critic);
  registerTwin(registry, twin, workflows);
  registerProfile(registry, profile, twin);
  const evolveTick = () => runEvolutionPass(evolver, config.paths.actionDir, bus);
  evolveTick(); // one pass at startup
  setInterval(evolveTick, 86_400_000).unref(); // daily; unref so it never holds the process open
  // Proactivity v2: the twin learns when tasks recur; nudge (suggest-only) at the learned peak hour.
  const anticipateTick = () => {
    for (const task of twin.anticipate()) bus.publish({ domain: "proactivity", type: "suggest_schedule", payload: { task, reason: "anticipated" } });
  };
  anticipateTick(); // check once at startup
  setInterval(anticipateTick, 3_600_000).unref(); // hourly; unref so it never holds the process open
  startResourceGuard(gate); // throttle background work under CPU load
  attachNotificationSink(bus); // surface trigger notifications (Phase 14 swaps in an OS toast)
  if (config.budgetUsd > 0) {
    new BudgetWatcher(join(config.paths.workspaceDir, "usage.jsonl"), config.budgetUsd, bus).start();
    process.stdout.write(`[budget] weekly alert at $${config.budgetUsd}\n`);
  }

  // Phase 10: connectors — inbound triage + outbound send RPC, MCP servers, realtime SSE stream.
  const connectors = new Map<string, Connector>([["local", new LocalConnector()]]);
  for (const [channel, url] of Object.entries(parseWebhooks())) connectors.set(channel, new WebhookConnector(channel, url));
  // §11a email channel: real Gmail (app-password SMTP) when GMAIL_USER + GMAIL_APP_PASSWORD are set, else
  // the stub that throws loudly. Send stays behind the F0 send-class gate at the RPC layer.
  if (!connectors.has("email")) {
    const gmail = new GmailConnector();
    connectors.set("email", gmail.configured ? gmail : new StubMailConnector());
    if (gmail.configured) process.stdout.write("[email] Gmail SMTP connector active (app password)\n");
  }
  for (const c of tokenChannels()) connectors.set(c.channel, c); // §11h(ii): telegram/slack/sms when tokens set
  registerConnectors(registry, { router, model: config.provider.model, memory, bus, runLog: new RunLog(), voice: profile.render(), runAgent: async (prompt) => (await agentService.startTurn(undefined, prompt)).final }, connectors);
  registerMeeting(registry, { router, model: config.provider.model, memory }); // §12e meeting agent: transcript→summary (live-join owed)
  // §12c inbound: scheduled multi-connector auto-fetch. Each enabled source (Gmail POP3, watched folder,
  // …) polls on its interval → daily-driver. Per-source on/off via VISHU_SYNC_<NAME>, interval via
  // VISHU_SYNC_<NAME>_MS / VISHU_SYNC_MS. Sources with no config are auto-disabled (no-op).
  startSync(
    { router, model: config.provider.model, memory, bus, runLog: new RunLog(), voice: profile.render() },
    [gmailSource(), folderSource()],
    { seenDir: config.paths.workspaceDir },
  );
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) process.stdout.write(`[sync] gmail inbound poll every ${Number(process.env.VISHU_SYNC_GMAIL_MS) || Number(process.env.VISHU_SYNC_MS) || 120000}ms\n`);
  if (process.env.VISHU_SYNC_FOLDER) process.stdout.write(`[sync] folder inbound: watching ${process.env.VISHU_SYNC_FOLDER}\n`);
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
  // Phase 2.3 F2: also discover per-repo adapters under integrations/<name>/jarvis-adapter.json. MCP-kind
  // adapters merge into the DomainManager (same mount path); CLI/data-kind register as namespaced tools.
  const integrationsDir = process.env.VISHU_INTEGRATIONS_DIR || join(process.cwd(), "..", "integrations");
  const adapters = loadRepoAdapters(integrationsDir);
  const domainTools = await new DomainManager([...loadDomains(domainsFile), ...toDomainConfigs(adapters)], tools, { bus, sampler }).start();
  const adapterTools = registerAdapterTools(tools, adapters);
  const attached = [...domainTools, ...adapterTools];
  if (attached.length) process.stdout.write(`[domains] ${attached.length} tool(s): ${attached.join(", ")}\n`);

  // Phase 12: optional modules — off by default, enabled by VISHU_MODULES; core is unaffected when off.
  const modulesOn = await loadModules(MODULES, { tools, rpc: registry, bus, workspaceDir: config.paths.workspaceDir });
  if (modulesOn.length) process.stdout.write(`[modules] enabled: ${modulesOn.join(", ")}\n`);

  const corsOrigins = process.env.VISHU_CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean);
  // 11g: also serve the built web UI (packages/frontend Vite output) over the same port so it opens in a
  // plain browser, not only the Tauri shell. VISHU_WEBROOT overrides; missing dist just 404s (core fine).
  const webRoot = process.env.VISHU_WEBROOT ?? fileURLToPath(new URL("../../../frontend/dist", import.meta.url));
  const running = await startServer(registry, host(), config.port, bus, corsOrigins, webRoot);
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
      terminal: sandboxedTerminal(config.paths.actionDir),
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

    const artifacts = writeBuildArtifacts(config.paths.actionDir, report);
    process.stdout.write(
      [
        "",
        `[build] ${report.ok ? "DONE" : "BLOCKED"} — ${report.chunks.length} chunk(s), ${report.remediations} security remediation(s)`,
        `security: ${formatFindings(report.findings)}`,
        `gate: ${report.gate.ok ? "pass" : report.gate.issues.join("; ")}`,
        `owasp review (advisory): ${report.review || "none"}`,
        `app + artifacts: ${config.paths.actionDir}`,
        `  architecture: ${artifacts.architecture}`,
        `  pentest report: ${artifacts.pentest}`,
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

/** Unified ledger straight from the local logs (no running core): per-turn token+decision cost. */
function ledger(daysArg?: string): number {
  const config = loadConfig();
  const days = daysArg ? Number(daysArg) : 7;
  if (!Number.isFinite(days) || days <= 0) return usageErr("vishu ledger [days]");
  const events = readLedger(join(config.paths.workspaceDir, "usage.jsonl"), join(config.paths.workspaceDir, "decisions.jsonl"));
  const spans = readSpans(join(config.paths.workspaceDir, "spans.jsonl"));
  process.stdout.write(`${renderLedger(ledgerReport(events, days * 86_400_000, Date.now(), spans), days)}\n`);
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
    const terminal = sandboxedTerminal(repoDir);
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

/** Expose Vishu's tools to any MCP client. Default stdio (client spawns us); `--http [port]` listens on
 * 127.0.0.1 (bearer token required iff VISHU_MCP_TOKEN is set — "token optional"). Every external call
 * goes through a fail-closed ApprovalGate, so send/spend/delete/change_setting can never run unattended. */
async function mcpServe(argv: string[]): Promise<number> {
  const config = loadConfig();
  // No initToken here on purpose: the MCP server needs no Vishu auth token. stdio has none; HTTP is
  // open on localhost unless VISHU_MCP_TOKEN is set. Token-free by default.
  mkdirSync(config.paths.actionDir, { recursive: true });
  const tools = registerBuiltins(new ToolRegistry());
  const skills = new SkillIndex();
  skills.loadDir(config.paths.skillsDir);
  registerSkillTools(tools, skills);
  const memory = new MemoryStore(config.paths.vaultDir, config.paths.memoryDbFile, join(config.paths.workspaceDir, "memory-events.log"));
  registerMemoryTools(tools, memory, () => ""); // lexical recall (no embedder wired here) over the whole vault
  const gate = new ApprovalGate("ask_every_time", async () => false, { actionOf: (n) => tools.getAction(n) });
  const ctx: ToolContext = { policy: makePolicy("full", config.paths.actionDir), terminal: sandboxedTerminal(config.paths.actionDir) };
  const server = buildVishuMcpServer(tools, gate, ctx);

  const httpIdx = argv.indexOf("--http");
  if (httpIdx >= 0) {
    const port = Number(argv[httpIdx + 1]) || 8848;
    const token = process.env.VISHU_MCP_TOKEN || undefined;
    await serveMcpHttp(server, { port, token });
    process.stdout.write(`[mcp] HTTP on http://127.0.0.1:${port}${token ? " (bearer token required)" : " (open — localhost only)"}\n`);
    return 0; // the listening socket keeps the process alive until killed
  }
  await serveMcpStdio(server); // stdin handle keeps us alive; the client owns the lifecycle
  return 0;
}

async function main(argv: string[]): Promise<number> {
  // Load a .env from the working dir if present (Node 24 native, no dep). Absent → use the real env.
  try {
    process.loadEnvFile();
  } catch {
    /* no .env file — fall back to the ambient environment */
  }
  // Then fold in the shared workspace .env one level up (D:\Job Project\.env) — the single source of truth
  // for all provider keys the key assigner discovers. loadEnvFile does NOT overwrite already-set vars, so
  // the local .env above still wins; this only fills gaps. Missing → ignored (local/ambient env is enough).
  try {
    process.loadEnvFile(join(process.cwd(), "..", ".env"));
  } catch {
    /* no shared root .env — local/ambient env is enough */
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
  if (cmd === "vet") {
    // CF3c deterministic security gate on a repo dir (cross-cutting "vetRepo before it runs").
    // Non-zero exit when blocked so it's scriptable; still requires human approval to install/wire.
    const dir = argv[1];
    if (!dir) return usageErr("vishu vet <repo-dir>");
    const raw = analyzeRepo(dir);
    // Trusted repos (the user's own audited code) surface findings but don't hard-block (UPGRADES §2.3).
    const trusted = isTrustedRepo(dir, trustedRepoPaths(loadConfig().paths.workspaceDir));
    const res = trusted ? applyTrust(raw) : raw;
    if (trusted) process.stdout.write("[trusted repo — block-class findings downgraded to warn]\n");
    process.stdout.write(`${renderAnalysis(dir, res)}\n`);
    return res.blocked ? 1 : 0;
  }
  if (cmd === "trust") {
    // Manage the trusted-repo allowlist (outside any scanned repo). `--list` shows it; `--remove` untrusts.
    const workspaceDir = loadConfig().paths.workspaceDir;
    if (argv[1] === "--list" || !argv[1]) {
      const trusted = trustedRepoPaths(workspaceDir);
      process.stdout.write(trusted.length ? `${trusted.join("\n")}\n` : "no trusted repos\n");
      return 0;
    }
    const remove = argv.includes("--remove") || argv.includes("--untrust");
    const dir = argv.find((a, i) => i > 0 && !a.startsWith("--"));
    if (!dir) return usageErr("vishu trust <repo-dir> [--remove] | vishu trust --list");
    const next = setRepoTrust(workspaceDir, dir, !remove);
    process.stdout.write(`${remove ? "untrusted" : "trusted"} ${dir}\n${next.length} trusted repo(s)\n`);
    return 0;
  }
  if (cmd === "models") return modelsCmd(argv.slice(1));
  if (cmd === "keys") return keysCmd(argv.slice(1));
  if (cmd === "connect") return connectCmd(argv.slice(1));
  if (cmd === "mcp-serve") return mcpServe(argv.slice(1));
  if (cmd === "report") return report(argv[1]);
  if (cmd === "ledger") return ledger(argv[1]);
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
      "  vishu vet <repo-dir>         static security gate on a repo (PASS/WARN/BLOCKED; nonzero if blocked)",
      "  vishu trust <dir> [--remove] trust/untrust a repo (own audited code): findings warn, don't block",
      "  vishu report [days]          weekly token report: where tokens go + where they're wasted",
      "  vishu ledger [days]          unified token+decision ledger with per-turn cost attribution",
      "  vishu eval [runner]          run the eval suite (baseline|effort|moa) + track quality over time",
      "  vishu eval swebench [--limit N] [--file f] [--out p]   SWE-bench Lite: write predictions.jsonl",
      "  vishu rpc <method> [json]    call a method on a running core",
      "  vishu connect <name> [--list]  mount a downstream MCP (browser|github|composio|custom) into the gateway",
      "  vishu connect <app> --auth     turnkey Composio OAuth: opens the link, waits until connected",
      "  vishu mcp-serve [--http [port]]  expose Vishu's tools as an MCP server (stdio, or HTTP :8848)",
      "  vishu keys [--probe]         show the discovered provider-key pool + tier routing (probe = liveness)",
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
