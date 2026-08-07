export type AiProvider = "raycast" | "openai" | "gemini" | "anthropic" | "custom";

export type ApiKeyAiProvider = "openai" | "gemini" | "anthropic";

export type AiProviderErrorKind =
  | "configuration"
  | "authentication"
  | "rate-limit"
  | "provider-unavailable"
  | "invalid-response"
  | "request-failed"
  | "timeout"
  | "aborted";

export class AiProviderError extends Error {
  readonly provider: AiProvider;
  readonly kind: AiProviderErrorKind;
  readonly status?: number;

  constructor(
    provider: AiProvider,
    kind: AiProviderErrorKind,
    message: string,
    options?: ErrorOptions & { status?: number }
  ) {
    super(message, options);
    this.name = "AiProviderError";
    this.provider = provider;
    this.kind = kind;
    this.status = options?.status;
  }
}

export const AI_PROVIDER_DISPLAY_NAMES: Record<AiProvider, string> = {
  raycast: "Raycast AI",
  openai: "OpenAI",
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
  custom: "Custom AI",
};

export type AiPreferenceValues = {
  readonly aiProvider: AiProvider;
  readonly raycastModel?: string;
  readonly raycastModelName?: string;
  readonly openaiApiKey?: string;
  readonly openaiModel?: string;
  readonly openaiModelName?: string;
  readonly openaiThinkingLevel?: import("./ai-thinking").AiThinkingLevel;
  readonly geminiApiKey?: string;
  readonly geminiModel?: string;
  readonly geminiModelName?: string;
  readonly geminiThinkingLevel?: import("./ai-thinking").AiThinkingLevel;
  readonly anthropicApiKey?: string;
  readonly anthropicModel?: string;
  readonly anthropicModelName?: string;
  readonly anthropicThinkingLevel?: import("./ai-thinking").AiThinkingLevel;
  readonly customProviderName?: string;
  readonly customBaseUrl?: string;
  readonly customModel?: string;
  readonly customApiKey?: string;
  readonly customHeadersJson?: string;
};
