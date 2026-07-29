import type { AiClient } from "../domain/template-engine";
import { httpPost, type AiFetchLike } from "./ai-http-client";
import { AiProviderError } from "./ai-provider";
import { openAiMaxOutputTokens, type AiThinkingLevel } from "./ai-thinking";

export class OpenAiAiClient implements AiClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetch: AiFetchLike = globalThis.fetch,
    private readonly timeoutMs = 60_000,
    private readonly thinkingLevel?: AiThinkingLevel
  ) {}

  async ask(prompt: string, signal?: AbortSignal): Promise<string> {
    const response = await httpPost("openai", {
      url: "https://api.openai.com/v1/responses",
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: {
        model: this.model,
        input: prompt,
        store: false,
        max_output_tokens: openAiMaxOutputTokens(this.thinkingLevel),
        ...(this.thinkingLevel ? { reasoning: { effort: this.thinkingLevel } } : {}),
      },
      signal,
      timeoutMs: this.timeoutMs,
      fetch: this.fetch,
      sensitiveValues: [this.apiKey, prompt],
    });

    const texts = extractTexts(response);
    if (texts.length === 0) {
      throw new AiProviderError("openai", "invalid-response", "OpenAI returned no text");
    }

    return texts.join("");
  }
}

function extractTexts(response: unknown): readonly string[] {
  if (!isRecord(response) || !Array.isArray(response.output)) {
    return [];
  }
  const texts: string[] = [];
  for (const block of response.output) {
    if (!isRecord(block) || !Array.isArray(block.content)) {
      continue;
    }
    for (const content of block.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string" &&
        content.text.length > 0
      ) {
        texts.push(content.text);
      }
    }
  }

  return texts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
