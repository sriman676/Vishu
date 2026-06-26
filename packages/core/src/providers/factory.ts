import type { ProviderConfig } from "../config/config.js";
import type { Cassette } from "../replay/cassette.js";
import type { UsageLog } from "../usage/log.js";
import { AnthropicProvider } from "./anthropic.js";
import { EchoProvider } from "./mock.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { Router } from "./router.js";
import type { Provider } from "./types.js";

/** Build a Router from config: one provider instance per API key so failover rotates keys.
 * Pass a UsageLog to capture per-call token usage; a Cassette to record/replay calls. */
export function buildRouter(cfg: ProviderConfig, usageLog?: UsageLog, cassette?: Cassette): Router {
  if (cfg.type === "mock") return new Router([new EchoProvider()], usageLog, cassette);
  if (cfg.type === "ollama") return new Router([new OllamaProvider({ baseUrl: cfg.baseUrl })], usageLog, cassette);

  const keys = cfg.apiKeys.length ? cfg.apiKeys : [""];
  const providers: Provider[] = keys.map((apiKey, i) => {
    const name = `${cfg.type}(${cfg.keyLabels[i] ?? `backup${i}`})`;
    return cfg.type === "anthropic"
      ? new AnthropicProvider({ name, baseUrl: cfg.baseUrl, apiKey })
      : new OpenAICompatibleProvider({ name, baseUrl: cfg.baseUrl, apiKey });
  });
  return new Router(providers, usageLog, cassette);
}
