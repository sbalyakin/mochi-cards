import { AI, environment } from "@raycast/api";

import type { AiClient } from "../domain/template-engine";
import { AiProviderError } from "./ai-provider";

type RaycastAiRequest = (prompt: string, options?: AI.AskOptions) => Promise<string>;

export type RaycastAiModel = {
  readonly id: string;
  readonly displayName: string;
};

export const DEFAULT_RAYCAST_AI_MODEL = AI.Model["OpenAI_GPT-5_mini"];

export class RaycastAiClient implements AiClient {
  constructor(
    private readonly model: string | undefined = undefined,
    private readonly request: RaycastAiRequest = (prompt, options) => AI.ask(prompt, options),
    private readonly canAccess: () => boolean = () => environment.canAccess(AI)
  ) {}

  async ask(prompt: string, signal?: AbortSignal): Promise<string> {
    if (!this.canAccess()) {
      throw new AiProviderError("raycast", "authentication", "Raycast AI access is required for this field");
    }

    try {
      return await this.request(prompt, { model: resolveRaycastAiModel(this.model), signal });
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

export function availableRaycastAiModels(): readonly RaycastAiModel[] {
  const seen = new Set<string>();
  const entries = Object.entries(AI.Model);
  const firstDeprecatedIndex = entries.findIndex(([name]) => name === "Google_Gemini_3_Pro");
  const currentEntries = firstDeprecatedIndex === -1 ? entries : entries.slice(0, firstDeprecatedIndex);
  return currentEntries.flatMap(([name, id]) => {
    if (seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [{ id, displayName: raycastModelDisplayName(name) }];
  });
}

function resolveRaycastAiModel(model: string | undefined): AI.Model {
  return Object.values(AI.Model).includes(model as AI.Model) ? (model as AI.Model) : DEFAULT_RAYCAST_AI_MODEL;
}

function raycastModelDisplayName(name: string): string {
  return name
    .split("_")
    .map((part) => (/^(mini|nano|instant|beta)$/i.test(part) ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function safeErrorDetail(error: unknown, prompt: string): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  if (!message) {
    return undefined;
  }
  return message.split(prompt).join("[redacted]").replace(/\s+/g, " ").trim().slice(0, 240) || undefined;
}
