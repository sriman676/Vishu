import type { ProviderConfig } from "../config/config.js";
import { AnthropicProvider } from "./anthropic.js";
import { EchoProvider } from "./mock.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { Router } from "./router.js";
import type { Provider } from "./types.js";

/** Build a Router from config: one provider instance per API key so failover rotates keys. */
export function buildRouter(cfg: ProviderConfig): Router {
  if (cfg.type === "mock") return new Router([new EchoProvider()]);
  if (cfg.type === "ollama") return new Router([new OllamaProvider({ baseUrl: cfg.baseUrl })]);

  const keys = cfg.apiKeys.length ? cfg.apiKeys : [""];
  const providers: Provider[] = keys.map((apiKey, i) => {
    const name = `${cfg.type}#${i}`;
    return cfg.type === "anthropic"
      ? new AnthropicProvider({ name, baseUrl: cfg.baseUrl, apiKey })
      : new OpenAICompatibleProvider({ name, baseUrl: cfg.baseUrl, apiKey });
  });
  return new Router(providers);
}
