import type { AiClient } from "../domain/template-engine";
import { AiProviderError } from "./ai-provider";
import { httpPost, type AiFetchLike } from "./ai-http-client";

export class GeminiAiClient implements AiClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetch: AiFetchLike = globalThis.fetch,
    private readonly timeoutMs = 60_000
  ) {}

  async ask(prompt: string, signal?: AbortSignal): Promise<string> {
    const encodedModel = encodeURIComponent(this.model);

    const response = await httpPost("gemini", {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent`,
      method: "POST",
      headers: {
        "x-goog-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 4096,
        },
      },
      signal,
      timeoutMs: this.timeoutMs,
      fetch: this.fetch,
      sensitiveValues: [this.apiKey, prompt],
    });

    const texts = extractTexts(response);
    if (texts.length === 0) {
      throw new AiProviderError("gemini", "invalid-response", "Gemini returned no text");
    }

    return texts.join("");
  }
}

function extractTexts(response: unknown): readonly string[] {
  if (!isRecord(response) || !Array.isArray(response.candidates)) {
    return [];
  }
  const texts: string[] = [];
  const firstCandidate = response.candidates[0];
  if (!isRecord(firstCandidate) || !isRecord(firstCandidate.content) || !Array.isArray(firstCandidate.content.parts)) {
    return texts;
  }
  for (const part of firstCandidate.content.parts) {
    if (isRecord(part) && typeof part.text === "string" && part.text.length > 0) {
      texts.push(part.text);
    }
  }

  return texts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
