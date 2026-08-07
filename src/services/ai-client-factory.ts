import type { AiClient } from "../domain/template-engine";
import { AnthropicAiClient } from "./anthropic-ai-client";
import type { AiFetchLike } from "./ai-http-client";
import { CustomAiClient } from "./custom-ai-client";
import { parseCustomHeaders, validateCustomBaseUrl, withBearerAuthorization } from "./custom-ai-configuration";
import { GeminiAiClient } from "./gemini-ai-client";
import { OpenAiAiClient } from "./openai-ai-client";
import {
  AiProviderError,
  AI_PROVIDER_DISPLAY_NAMES,
  type AiPreferenceValues,
  type ApiKeyAiProvider,
} from "./ai-provider";
import { RaycastAiClient } from "./raycast-ai-client";

export type AiClientFactoryOptions = {
  readonly fetch?: AiFetchLike;
  readonly timeoutMs?: number;
};

export function createAiClient(preferences: AiPreferenceValues, options: AiClientFactoryOptions = {}): AiClient {
  switch (preferences.aiProvider) {
    case "raycast":
      return new RaycastAiClient(preferences.raycastModel);

    case "openai": {
      const apiKey = (preferences.openaiApiKey ?? "").trim();
      const model = (preferences.openaiModel ?? "").trim();
      validateConfiguration("openai", apiKey, model);
      return new OpenAiAiClient(apiKey, model, options.fetch, options.timeoutMs, preferences.openaiThinkingLevel);
    }

    case "gemini": {
      const apiKey = (preferences.geminiApiKey ?? "").trim();
      const model = (preferences.geminiModel ?? "").trim();
      validateConfiguration("gemini", apiKey, model);
      return new GeminiAiClient(apiKey, model, options.fetch, options.timeoutMs, preferences.geminiThinkingLevel);
    }

    case "anthropic": {
      const apiKey = (preferences.anthropicApiKey ?? "").trim();
      const model = (preferences.anthropicModel ?? "").trim();
      validateConfiguration("anthropic", apiKey, model);
      return new AnthropicAiClient(apiKey, model, options.fetch, options.timeoutMs, preferences.anthropicThinkingLevel);
    }

    case "custom": {
      const displayName = (preferences.customProviderName ?? "").trim() || AI_PROVIDER_DISPLAY_NAMES.custom;
      const model = (preferences.customModel ?? "").trim();
      if (!model) {
        throw new AiProviderError("custom", "configuration", `${displayName} model ID is required`);
      }
      const baseUrl = validateCustomBaseUrl(preferences.customBaseUrl ?? "", displayName);
      const headers = withBearerAuthorization(
        parseCustomHeaders(preferences.customHeadersJson, displayName),
        preferences.customApiKey,
        displayName
      );
      return new CustomAiClient(baseUrl, model, headers, displayName, options.fetch, options.timeoutMs);
    }

    default:
      return assertNever(preferences.aiProvider);
  }
}

function validateConfiguration(provider: ApiKeyAiProvider, apiKey: string, model: string): void {
  const displayName = AI_PROVIDER_DISPLAY_NAMES[provider];
  if (!apiKey) {
    throw new AiProviderError(provider, "configuration", `${displayName} API key is required`);
  }
  if (!model) {
    throw new AiProviderError(provider, "configuration", `${displayName} model ID is required`);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported AI provider: ${String(value)}`);
}
