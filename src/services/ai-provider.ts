export type AiProvider = "raycast" | "openai" | "gemini" | "anthropic";

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
};

export type AiPreferenceValues = {
  readonly aiProvider: AiProvider;
  readonly openaiApiKey?: string;
  readonly openaiModel?: string;
  readonly openaiModelName?: string;
  readonly geminiApiKey?: string;
  readonly geminiModel?: string;
  readonly geminiModelName?: string;
  readonly anthropicApiKey?: string;
  readonly anthropicModel?: string;
  readonly anthropicModelName?: string;
};
