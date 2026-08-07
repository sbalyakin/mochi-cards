import { AI_PROVIDER_DISPLAY_NAMES, type AiPreferenceValues } from "./ai-provider";

export function displayAiModelName(settings: AiPreferenceValues): string {
  switch (settings.aiProvider) {
    case "raycast":
      return (
        settings.raycastModelName ??
        (settings.raycastModel ? humanizeAiModelId(settings.raycastModel) : AI_PROVIDER_DISPLAY_NAMES.raycast)
      );
    case "openai":
      return (
        settings.openaiModelName ??
        (settings.openaiModel ? humanizeAiModelId(settings.openaiModel) : AI_PROVIDER_DISPLAY_NAMES.openai)
      );
    case "gemini":
      return (
        settings.geminiModelName ??
        (settings.geminiModel ? humanizeAiModelId(settings.geminiModel) : AI_PROVIDER_DISPLAY_NAMES.gemini)
      );
    case "anthropic":
      return (
        settings.anthropicModelName ??
        (settings.anthropicModel ? humanizeAiModelId(settings.anthropicModel) : AI_PROVIDER_DISPLAY_NAMES.anthropic)
      );
    case "custom":
      return settings.customModel
        ? humanizeAiModelId(settings.customModel)
        : settings.customProviderName?.trim() || AI_PROVIDER_DISPLAY_NAMES.custom;
  }
}

export function humanizeAiModelId(modelId: string): string {
  const claudeMatch = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?(?:-\d{8})?$/.exec(modelId);
  if (claudeMatch) {
    const family = `${claudeMatch[1][0].toUpperCase()}${claudeMatch[1].slice(1)}`;
    const version = claudeMatch[3] ? `${claudeMatch[2]}.${claudeMatch[3]}` : claudeMatch[2];
    return `Claude ${family} ${version}`;
  }
  const parts = modelId.split("-");
  const titleParts = parts.map((part) => {
    if (part === "tts") {
      return "TTS";
    }
    if (part === "api") {
      return "API";
    }
    if (/^o\d+$/.test(part) || /^\d+(?:\.\d+)?$/.test(part)) {
      return part;
    }
    return `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`;
  });
  return parts[0] === "gpt" ? `GPT-${titleParts.slice(1).join(" ")}` : titleParts.join(" ");
}
