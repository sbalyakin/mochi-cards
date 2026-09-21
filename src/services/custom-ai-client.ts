import type { AiClient } from "../domain/template-engine";
import { httpPost, type AiFetchLike } from "./ai-http-client";
import { AiProviderError } from "./ai-provider";
import type { AiThinkingLevel } from "./ai-thinking";
import { normalizeCustomHeaders, sensitiveHeaderValues } from "./custom-ai-configuration";

export class CustomAiClient implements AiClient {
  private maxTokensParameter: "max_tokens" | "max_completion_tokens" = "max_tokens";

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly headers: Readonly<Record<string, string>>,
    private readonly displayName: string,
    private readonly fetch: AiFetchLike = globalThis.fetch,
    private readonly timeoutMs = 180_000,
    private readonly thinkingLevel?: AiThinkingLevel
  ) {}

  async ask(prompt: string, signal?: AbortSignal): Promise<string> {
    const headers = normalizeCustomHeaders(this.headers, this.displayName);
    const request = (maxTokensParameter: "max_tokens" | "max_completion_tokens") =>
      httpPost("custom", {
        url: `${this.baseUrl}/chat/completions`,
        method: "POST",
        headers: withJsonContentType(headers),
        body: {
          model: this.model,
          messages: [{ role: "user", content: prompt }],
          [maxTokensParameter]: 4096,
          ...(this.thinkingLevel ? { reasoning_effort: this.thinkingLevel } : {}),
        },
        signal,
        timeoutMs: this.timeoutMs,
        fetch: this.fetch,
        sensitiveValues: [prompt, ...sensitiveHeaderValues(headers)],
        displayName: this.displayName,
        redirect: "error",
      });

    let response: unknown;
    try {
      response = await request(this.maxTokensParameter);
    } catch (error: unknown) {
      if (
        this.maxTokensParameter !== "max_tokens" ||
        !(error instanceof AiProviderError) ||
        error.status !== 400 ||
        !error.message.includes("max_tokens") ||
        !error.message.includes("max_completion_tokens")
      ) {
        throw error;
      }
      this.maxTokensParameter = "max_completion_tokens";
      response = await request(this.maxTokensParameter);
    }

    const text = extractText(response);
    if (!text) {
      throw new AiProviderError("custom", "invalid-response", `${this.displayName} returned no text`);
    }

    return text;
  }
}

/**
 * Merges caller-supplied headers with a forced JSON Content-Type, removing
 * any existing Content-Type header case-insensitively so it cannot combine
 * with the forced value into an invalid header.
 */
function withJsonContentType(headers: Readonly<Record<string, string>>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLocaleLowerCase() !== "content-type") {
      merged[key] = value;
    }
  }
  merged["Content-Type"] = "application/json";
  return merged;
}

function extractText(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    return "";
  }
  for (const choice of response.choices) {
    if (
      isRecord(choice) &&
      isRecord(choice.message) &&
      typeof choice.message.content === "string" &&
      choice.message.content.length > 0
    ) {
      return choice.message.content;
    }
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
