import type { ProviderConfig } from "../config/config.js";
import type { Cassette } from "../replay/cassette.js";
import type { Tracer } from "../reliability/trace.js";
import type { UsageLog } from "../usage/log.js";
import { AnthropicProvider } from "./anthropic.js";
import { EchoProvider } from "./mock.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { type KeyMode, Router } from "./router.js";
import type { ChatRequest, Provider } from "./types.js";

/** Multi-key routing mode (VISHU_KEY_MODE): failover (default) | balance | local. */
function keyMode(env = process.env): KeyMode {
  const m = env.VISHU_KEY_MODE;
  return m === "balance" || m === "local" ? m : "failover";
}

/** Wrap a provider so every call uses `model`, overriding the request's model. Lets one pooled Router mix
 * providers that each need a different model (Anthropic + OpenAI + local) — each endpoint forces its own. */
function bindModel(p: Provider, model: string): Provider {
  return {
    name: p.name,
    local: p.local,
    chat: (req: ChatRequest) => p.chat({ ...req, model }),
    chatStream: (req, onDelta) => p.chatStream({ ...req, model }, onDelta),
    embed: p.embed ? (texts) => p.embed!(texts) : undefined,
  };
}

/** One endpoint per API key for a single provider config; key rotation/balance happens across these. */
function providerEndpoints(cfg: ProviderConfig, label: string): Provider[] {
  if (cfg.type === "mock") return [new EchoProvider()];
  if (cfg.type === "ollama") return [new OllamaProvider({ name: `${label}(local)`, baseUrl: cfg.baseUrl })];
  const keys = cfg.apiKeys.length ? cfg.apiKeys : [""];
  return keys.map((apiKey, i) => {
    const name = `${label}(${cfg.keyLabels[i] ?? `backup${i}`})`;
    return cfg.type === "anthropic"
      ? new AnthropicProvider({ name, baseUrl: cfg.baseUrl, apiKey })
      : new OpenAICompatibleProvider({ name, baseUrl: cfg.baseUrl, apiKey });
  });
}

/** A local Ollama endpoint to fold into the ring when VISHU_LOCAL_BASE_URL is set — lets cloud keys and a
 * local LLM serve in parallel under `balance`/`local` modes. VISHU_LOCAL_MODEL binds its model. */
function localEndpoint(env = process.env): Provider | undefined {
  if (!env.VISHU_LOCAL_BASE_URL) return undefined;
  const ep = new OllamaProvider({ name: "ollama(local)", baseUrl: env.VISHU_LOCAL_BASE_URL });
  return env.VISHU_LOCAL_MODEL ? bindModel(ep, env.VISHU_LOCAL_MODEL) : ep;
}

/** Build a Router from one provider config: one endpoint per API key so failover/balance rotate keys.
 * Pass a UsageLog to capture per-call token usage; a Cassette to record/replay calls. */
export function buildRouter(cfg: ProviderConfig, usageLog?: UsageLog, cassette?: Cassette, tracer?: Tracer): Router {
  const endpoints = providerEndpoints(cfg, cfg.type);
  const local = localEndpoint();
  if (local) endpoints.push(local);
  return new Router(endpoints, usageLog, cassette, keyMode(), tracer);
}

/** Multi-provider pool: span every named provider (each bound to its own model) plus an optional local LLM
 * in one Router. The user chooses parallel vs sequential via VISHU_KEY_MODE — `balance` round-robins the
 * whole pool (parallel), `failover` tries them one after another, `local` prefers the on-device model.
 * ponytail: token-report attribution uses the request's model, not each endpoint's bound model — the
 * per-model breakdown is approximate under pooling; thread the bound model through usage to make it exact. */
export function buildPoolRouter(providers: Record<string, ProviderConfig>, usageLog?: UsageLog, cassette?: Cassette, tracer?: Tracer): Router {
  const endpoints: Provider[] = [];
  for (const [name, cfg] of Object.entries(providers)) {
    for (const ep of providerEndpoints(cfg, name)) endpoints.push(bindModel(ep, cfg.model));
  }
  const local = localEndpoint();
  if (local) endpoints.push(local);
  if (!endpoints.length) throw new Error("[pool] no providers configured");
  return new Router(endpoints, usageLog, cassette, keyMode(), tracer);
}
