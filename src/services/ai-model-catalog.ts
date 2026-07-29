import { httpGet, type AiFetchLike } from "./ai-http-client";
import { AI_PROVIDER_DISPLAY_NAMES, AiProviderError, type AiProvider } from "./ai-provider";

export type ExternalAiProvider = Exclude<AiProvider, "raycast">;

export type AiModel = {
  readonly id: string;
  readonly displayName?: string;
  readonly group?: string;
  readonly thinkingSupported?: boolean;
};

export class AiModelCatalog {
  constructor(
    private readonly fetch: AiFetchLike = globalThis.fetch,
    private readonly timeoutMs = 60_000
  ) {}

  async list(provider: ExternalAiProvider, apiKey: string, signal?: AbortSignal): Promise<readonly AiModel[]> {
    const normalizedKey = apiKey.trim();
    if (!normalizedKey) {
      throw new AiProviderError(
        provider,
        "configuration",
        `${AI_PROVIDER_DISPLAY_NAMES[provider]} API key is required`
      );
    }

    switch (provider) {
      case "openai":
        return this.listOpenAi(normalizedKey, signal);
      case "gemini":
        return this.listGemini(normalizedKey, signal);
      case "anthropic":
        return this.listAnthropic(normalizedKey, signal);
    }
  }

  private async listOpenAi(apiKey: string, signal?: AbortSignal): Promise<readonly AiModel[]> {
    const response = await this.get(
      "openai",
      "https://api.openai.com/v1/models",
      {
        Authorization: `Bearer ${apiKey}`,
      },
      apiKey,
      signal
    );
    if (!isRecord(response) || !Array.isArray(response.data)) {
      throw invalidModelList("openai");
    }
    return sortOpenAiModels(
      uniqueSortedModels(
        response.data.flatMap((model) =>
          isRecord(model) && typeof model.id === "string" && isOpenAiTextModel(model.id)
            ? [{ id: model.id, ...openAiModelMetadata(model.id) }]
            : []
        )
      )
    );
  }

  private async listGemini(apiKey: string, signal?: AbortSignal): Promise<readonly AiModel[]> {
    const models: AiModel[] = [];
    const seenTokens = new Set<string>();
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ pageSize: "1000" });
      if (pageToken) {
        query.set("pageToken", pageToken);
      }
      const response = await this.get(
        "gemini",
        `https://generativelanguage.googleapis.com/v1beta/models?${query.toString()}`,
        { "x-goog-api-key": apiKey },
        apiKey,
        signal
      );
      if (!isRecord(response) || !Array.isArray(response.models)) {
        throw invalidModelList("gemini");
      }
      for (const model of response.models) {
        if (
          isRecord(model) &&
          typeof model.name === "string" &&
          Array.isArray(model.supportedGenerationMethods) &&
          model.supportedGenerationMethods.includes("generateContent") &&
          isGeminiTextModel(model)
        ) {
          const id = model.name.startsWith("models/") ? model.name.slice("models/".length) : model.name;
          models.push({
            id,
            group: geminiModelGroup(id),
            ...(typeof model.displayName === "string" ? { displayName: model.displayName } : {}),
            ...(typeof model.thinking === "boolean" ? { thinkingSupported: model.thinking } : {}),
          });
        }
      }
      pageToken = optionalString(response.nextPageToken);
      ensureNewPageToken("gemini", pageToken, seenTokens);
    } while (pageToken);
    return uniqueSortedModels(models);
  }

  private async listAnthropic(apiKey: string, signal?: AbortSignal): Promise<readonly AiModel[]> {
    const models: AiModel[] = [];
    const seenIds = new Set<string>();
    let afterId: string | undefined;
    let hasMore = false;
    do {
      const query = new URLSearchParams({ limit: "1000" });
      if (afterId) {
        query.set("after_id", afterId);
      }
      const response = await this.get(
        "anthropic",
        `https://api.anthropic.com/v1/models?${query.toString()}`,
        { "anthropic-version": "2023-06-01", "x-api-key": apiKey },
        apiKey,
        signal
      );
      if (!isRecord(response) || !Array.isArray(response.data) || typeof response.has_more !== "boolean") {
        throw invalidModelList("anthropic");
      }
      for (const model of response.data) {
        if (
          isRecord(model) &&
          model.type === "model" &&
          typeof model.id === "string" &&
          model.id.startsWith("claude-")
        ) {
          models.push({
            id: model.id,
            group: claudeModelGroup(model.id),
            ...(typeof model.display_name === "string" ? { displayName: model.display_name } : {}),
            ...optionalThinkingSupport(model),
          });
        }
      }
      hasMore = response.has_more;
      afterId = hasMore ? optionalString(response.last_id) : undefined;
      if (hasMore && !afterId) {
        throw invalidModelList("anthropic");
      }
      ensureNewPageToken("anthropic", afterId, seenIds);
    } while (hasMore);
    return sortClaudeModels(uniqueSortedModels(models));
  }

  private get(
    provider: ExternalAiProvider,
    url: string,
    headers: Record<string, string>,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    return httpGet(provider, {
      url,
      headers,
      signal,
      timeoutMs: this.timeoutMs,
      fetch: this.fetch,
      sensitiveValues: [apiKey],
    });
  }
}

export function normalizeSelectedModelId(provider: ExternalAiProvider, modelId: string): string {
  const normalized = modelId.trim();
  return provider === "gemini" && normalized.startsWith("models/") ? normalized.slice("models/".length) : normalized;
}

function uniqueSortedModels(models: readonly AiModel[]): readonly AiModel[] {
  const unique = new Map<string, AiModel>();
  for (const model of models) {
    if (model.id.length > 0 && !unique.has(model.id)) {
      unique.set(model.id, model);
    }
  }
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function sortOpenAiModels(models: readonly AiModel[]): readonly AiModel[] {
  return [...models].sort((left, right) => compareOpenAiModelIds(left.id, right.id));
}

export function sortClaudeModels(models: readonly AiModel[]): readonly AiModel[] {
  return [...models].sort((left, right) => compareClaudeModelIds(left.id, right.id));
}

function compareClaudeModelIds(leftId: string, rightId: string): number {
  const leftVersion = claudeModelVersion(leftId);
  const rightVersion = claudeModelVersion(rightId);
  const length = Math.max(leftVersion.length, rightVersion.length);
  for (let index = 0; index < length; index += 1) {
    const left = leftVersion[index] ?? 0;
    const right = rightVersion[index] ?? 0;
    if (left !== right) {
      return right - left;
    }
  }
  return leftId.localeCompare(rightId);
}

function claudeModelVersion(modelId: string): readonly number[] {
  return modelId.match(/\d+/g)?.map(Number) ?? [];
}

function compareOpenAiModelIds(leftId: string, rightId: string): number {
  const left = openAiModelOrder(leftId);
  const right = openAiModelOrder(rightId);
  if (left.major !== right.major) {
    return right.major - left.major;
  }
  if (left.minor !== right.minor) {
    return right.minor - left.minor;
  }
  if (left.tier !== right.tier) {
    return right.tier - left.tier;
  }
  return leftId.localeCompare(rightId);
}

function openAiModelOrder(modelId: string): { readonly major: number; readonly minor: number; readonly tier: number } {
  const gptMatch = /^gpt-(\d+)(?:\.(\d+))?/.exec(modelId);
  if (gptMatch) {
    return {
      major: Number(gptMatch[1]),
      minor: Number(gptMatch[2] ?? 0),
      tier: openAiModelTier(modelId),
    };
  }
  const reasoningMatch = /^o(\d+)/.exec(modelId);
  return {
    major: reasoningMatch ? Number(reasoningMatch[1]) : 0,
    minor: 0,
    tier: openAiModelTier(modelId),
  };
}

function openAiModelTier(modelId: string): number {
  if (modelId.includes("sol")) {
    return 5;
  }
  if (modelId.includes("pro")) {
    return 4;
  }
  if (modelId.includes("terra")) {
    return 3;
  }
  if (modelId.includes("mini")) {
    return 1;
  }
  if (modelId.includes("luna") || modelId.includes("nano")) {
    return 0;
  }
  return 2;
}

function isOpenAiTextModel(modelId: string): boolean {
  const id = modelId.toLocaleLowerCase();
  const isSupportedFamily = /^(chat-latest|gpt-(4o|4\.1|5)(?:[.-]|$)|o[134](?:-|$))/.test(id);
  const isDatedVersion = /\d{4}-\d{2}-\d{2}$/.test(id);
  return (
    isSupportedFamily &&
    !isDatedVersion &&
    !/(audio|codex|embedding|image|moderation|realtime|search|sora|transcri|tts|whisper)/.test(id)
  );
}

function openAiModelMetadata(modelId: string): Pick<AiModel, "group"> {
  return { group: openAiModelGroup(modelId) };
}

function openAiModelGroup(modelId: string): string {
  if (modelId.startsWith("gpt-5")) {
    return "GPT-5";
  }
  if (modelId.startsWith("gpt-4.1")) {
    return "GPT-4.1";
  }
  if (modelId === "chat-latest" || /^o[134](?:-|$)/.test(modelId)) {
    return "Reasoning";
  }
  if (modelId.startsWith("gpt-4o")) {
    return "GPT-4o";
  }
  return "Other Models";
}

function isGeminiTextModel(model: Record<string, unknown>): boolean {
  const descriptor = [model.name, model.displayName, model.description]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();
  return (
    !/-\d{3}$/.test(String(model.name)) &&
    !/(antigravity|audio|computer-use|customtools|deep-research|image|lyria|nano banana|robotics|tts)/.test(descriptor)
  );
}

function geminiModelGroup(modelId: string): string {
  const version = /^gemini-(\d+(?:\.\d+)?)(?:-|$)/.exec(modelId);
  if (version) {
    return `Gemini ${version[1]}`;
  }
  if (/^gemini-(flash|flash-lite|pro)-latest$/.test(modelId)) {
    return "Gemini Latest";
  }
  if (modelId.startsWith("gemma-")) {
    return "Gemma";
  }
  return "Other Models";
}

function claudeModelGroup(modelId: string): string {
  const version = /^claude-(?:opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/.exec(modelId);
  return version ? `Claude ${version[1]}${version[2] ? `.${version[2]}` : ""}` : "Other Models";
}

function ensureNewPageToken(provider: ExternalAiProvider, token: string | undefined, seen: Set<string>): void {
  if (!token) {
    return;
  }
  if (seen.has(token)) {
    throw invalidModelList(provider);
  }
  seen.add(token);
}

function invalidModelList(provider: ExternalAiProvider): AiProviderError {
  return new AiProviderError(
    provider,
    "invalid-response",
    `${AI_PROVIDER_DISPLAY_NAMES[provider]} returned an invalid model list`
  );
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalThinkingSupport(
  model: Record<string, unknown>
): Pick<AiModel, "thinkingSupported"> | Record<never, never> {
  const thinking =
    isRecord(model.capabilities) && isRecord(model.capabilities.thinking) ? model.capabilities.thinking : undefined;
  return thinking && typeof thinking.supported === "boolean" ? { thinkingSupported: thinking.supported } : {};
}
