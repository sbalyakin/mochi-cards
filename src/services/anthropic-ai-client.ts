import type { AiClient } from "../domain/template-engine";
import { AiProviderError } from "./ai-provider";
import { httpPost, type AiFetchLike } from "./ai-http-client";

export class AnthropicAiClient implements AiClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetch: AiFetchLike = globalThis.fetch,
    private readonly timeoutMs = 60_000
  ) {}

  async ask(prompt: string, signal?: AbortSignal): Promise<string> {
    const response = await httpPost("anthropic", {
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: {
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      signal,
      timeoutMs: this.timeoutMs,
      fetch: this.fetch,
      sensitiveValues: [this.apiKey, prompt],
    });

    const texts = extractTexts(response);
    if (texts.length === 0) {
      throw new AiProviderError("anthropic", "invalid-response", "Anthropic returned no text");
    }

    return texts.join("");
  }
}

function extractTexts(response: unknown): readonly string[] {
  if (!isRecord(response) || !Array.isArray(response.content)) {
    return [];
  }
  const texts: string[] = [];
  for (const block of response.content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      texts.push(block.text);
    }
  }

  return texts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
