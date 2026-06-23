import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerAgent } from "../agent/rpc.js";
import { AgentService } from "../agent/service.js";
import { loadConfig } from "../config/config.js";
import { registerAutomation } from "../automation/rpc.js";
import { SchedulerGate } from "../automation/gate.js";
import { TriggerManager } from "../automation/triggers.js";
import { WorkflowStore } from "../automation/workflows.js";
import { registerMemory } from "../memory/rpc.js";
import { MemoryStore } from "../memory/store.js";
import { registerMemoryTools } from "../memory/tools.js";
import { registerOrchestrationTools } from "../orchestration/tools.js";
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

function usageErr(usage: string): number {
  process.stderr.write(`usage: ${usage}\n`);
  return 1;
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
  const memory = new MemoryStore(
    config.paths.vaultDir,
    config.paths.memoryDbFile,
    join(config.paths.workspaceDir, "memory-events.log"),
  );
  registerMemoryTools(tools, memory);
  registerMemory(registry, memory);
  const router = buildRouter(config.provider);
  registerOrchestrationTools(tools, { router, model: config.provider.model });
  const agentService = new AgentService({
    router,
    tools,
    policy: makePolicy("full", config.paths.actionDir),
    terminal: new Terminal(config.paths.actionDir),
    model: config.provider.model,
    runLog: new RunLog(),
  });
  registerAgent(registry, agentService);

  // Phase 9: proactive automation — saved workflows + triggers on a 5s cron tick / events / files.
  const workflows = new WorkflowStore(join(config.paths.workspaceDir, "workflows"));
  const triggers = new TriggerManager({
    bus,
    store: workflows,
    gate: new SchedulerGate(),
    autonomy: "automatic",
    run: async (step) => (await agentService.startTurn(undefined, step)).final,
    runLog: new RunLog(),
  });
  registerAutomation(registry, workflows, triggers);
  triggers.start();

  const running = await startServer(registry, host(), config.port);
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
  const router = buildRouter(config.provider);
  await router.chatStream(
    { model: config.provider.model, messages: [{ role: "user", content: text }] },
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
      router: buildRouter(config.provider),
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
      "  vishu rpc <method> [json]    call a method on a running core",
      "",
    ].join("\n"),
  );
  return cmd && cmd !== "help" && cmd !== "--help" ? 1 : 0;
}

process.exit(await main(process.argv.slice(2)));
