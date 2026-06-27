import type { ProviderConfig } from "../config/config.js";
import type { Cassette } from "../replay/cassette.js";
import type { UsageLog } from "../usage/log.js";
import { AnthropicProvider } from "./anthropic.js";
import { EchoProvider } from "./mock.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { type KeyMode, Router } from "./router.js";
import type { Provider } from "./types.js";

/** Multi-key routing mode (VISHU_KEY_MODE): failover (default) | balance | local. */
function keyMode(env = process.env): KeyMode {
  const m = env.VISHU_KEY_MODE;
  return m === "balance" || m === "local" ? m : "failover";
}

/** A local Ollama endpoint to fold into the ring when VISHU_LOCAL_BASE_URL is set — lets cloud keys and
 * a local LLM share one Router so `balance`/`local` modes can use the local model in parallel. */
function localEndpoint(env = process.env): Provider | undefined {
  return env.VISHU_LOCAL_BASE_URL ? new OllamaProvider({ name: "ollama(local)", baseUrl: env.VISHU_LOCAL_BASE_URL }) : undefined;
}

/** Build a Router from config: one provider instance per API key so failover/balance rotate keys.
 * Pass a UsageLog to capture per-call token usage; a Cassette to record/replay calls. */
export function buildRouter(cfg: ProviderConfig, usageLog?: UsageLog, cassette?: Cassette): Router {
  const mode = keyMode();
  const local = localEndpoint();
  if (cfg.type === "mock") return new Router([new EchoProvider()], usageLog, cassette, mode);
  if (cfg.type === "ollama") return new Router([new OllamaProvider({ baseUrl: cfg.baseUrl })], usageLog, cassette, mode);

  const keys = cfg.apiKeys.length ? cfg.apiKeys : [""];
  const providers: Provider[] = keys.map((apiKey, i) => {
    const name = `${cfg.type}(${cfg.keyLabels[i] ?? `backup${i}`})`;
    return cfg.type === "anthropic"
      ? new AnthropicProvider({ name, baseUrl: cfg.baseUrl, apiKey })
      : new OpenAICompatibleProvider({ name, baseUrl: cfg.baseUrl, apiKey });
  });
  if (local) providers.push(local); // cloud keys + a local LLM in one ring
  return new Router(providers, usageLog, cassette, mode);
}
