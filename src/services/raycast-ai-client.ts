import { AI, environment } from "@raycast/api";

import type { AiClient } from "../domain/template-engine";
import { AiProviderError } from "./ai-provider";

export class RaycastAiClient implements AiClient {
  async ask(prompt: string, signal?: AbortSignal): Promise<string> {
    if (!environment.canAccess(AI)) {
      throw new AiProviderError("raycast", "authentication", "Raycast AI access is required for this field");
    }

    try {
      return await AI.ask(prompt, { signal });
    } catch (error: unknown) {
      if (signal?.aborted) {
        throw new AiProviderError("raycast", "aborted", "AI generation was cancelled", { cause: error });
      }
      throw new AiProviderError("raycast", "request-failed", "Raycast AI request failed", { cause: error });
    }
  }
}
