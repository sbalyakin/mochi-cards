import { AI, environment } from "@raycast/api";

import type { AiClient } from "../domain/template-engine";
import { AiProviderError } from "./ai-provider";

type RaycastAiRequest = (prompt: string, options?: AI.AskOptions) => Promise<string>;

export class RaycastAiClient implements AiClient {
  constructor(
    private readonly request: RaycastAiRequest = (prompt, options) => AI.ask(prompt, options),
    private readonly canAccess: () => boolean = () => environment.canAccess(AI)
  ) {}

  async ask(prompt: string, signal?: AbortSignal): Promise<string> {
    if (!this.canAccess()) {
      throw new AiProviderError("raycast", "authentication", "Raycast AI access is required for this field");
    }

    try {
      return await this.request(prompt, { signal });
    } catch (error: unknown) {
      if (signal?.aborted) {
        throw new AiProviderError("raycast", "aborted", "AI generation was cancelled", { cause: error });
      }
      const detail = safeErrorDetail(error, prompt);
      throw new AiProviderError(
        "raycast",
        "request-failed",
        detail ? `Raycast AI request failed: ${detail}` : "Raycast AI request failed",
        { cause: error }
      );
    }
  }
}

function safeErrorDetail(error: unknown, prompt: string): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  if (!message) {
    return undefined;
  }
  return message.split(prompt).join("[redacted]").replace(/\s+/g, " ").trim().slice(0, 240) || undefined;
}
