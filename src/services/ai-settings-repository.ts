import type { AiPreferenceValues, AiProvider } from "./ai-provider";
import type { AiThinkingLevel } from "./ai-thinking";

const SETTINGS_STORAGE_KEY = "ai-provider-settings-v1";
const EXTERNAL_PROVIDERS = ["openai", "gemini", "anthropic"] as const;

type ExternalAiProvider = (typeof EXTERNAL_PROVIDERS)[number];

export interface AiSettingsValueStore {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: string): Promise<void>;
}

export interface AiSettingsSecretStore {
  getSecret(provider: ExternalAiProvider): Promise<string | undefined>;
  setSecret(provider: ExternalAiProvider, value: string | undefined): Promise<void>;
}

type StoredAiSettings = {
  readonly version: 3;
  readonly aiProvider: AiProvider;
  readonly openaiModel?: string;
  readonly openaiModelName?: string;
  readonly openaiThinkingLevel?: AiThinkingLevel;
  readonly geminiModel?: string;
  readonly geminiModelName?: string;
  readonly geminiThinkingLevel?: AiThinkingLevel;
  readonly anthropicModel?: string;
  readonly anthropicModelName?: string;
  readonly anthropicThinkingLevel?: AiThinkingLevel;
};

export class AiSettingsRepository {
  constructor(
    private readonly values: AiSettingsValueStore,
    private readonly secrets: AiSettingsSecretStore
  ) {}

  async get(): Promise<AiPreferenceValues> {
    const [storedValue, openaiApiKey, geminiApiKey, anthropicApiKey] = await Promise.all([
      this.values.getItem(SETTINGS_STORAGE_KEY),
      this.secrets.getSecret("openai"),
      this.secrets.getSecret("gemini"),
      this.secrets.getSecret("anthropic"),
    ]);
    const stored = parseStoredSettings(storedValue);
    return {
      aiProvider: stored.aiProvider,
      ...optionalValue("openaiApiKey", openaiApiKey),
      ...optionalValue("openaiModel", stored.openaiModel),
      ...optionalValue("openaiModelName", stored.openaiModelName),
      ...optionalThinkingValue("openaiThinkingLevel", stored.openaiThinkingLevel),
      ...optionalValue("geminiApiKey", geminiApiKey),
      ...optionalValue("geminiModel", stored.geminiModel),
      ...optionalValue("geminiModelName", stored.geminiModelName),
      ...optionalThinkingValue("geminiThinkingLevel", stored.geminiThinkingLevel),
      ...optionalValue("anthropicApiKey", anthropicApiKey),
      ...optionalValue("anthropicModel", stored.anthropicModel),
      ...optionalValue("anthropicModelName", stored.anthropicModelName),
      ...optionalThinkingValue("anthropicThinkingLevel", stored.anthropicThinkingLevel),
    };
  }

  async save(settings: AiPreferenceValues): Promise<AiPreferenceValues> {
    const normalized = normalizeSettings(settings);
    await Promise.all(
      EXTERNAL_PROVIDERS.map((provider) => this.secrets.setSecret(provider, apiKeyFor(normalized, provider)))
    );
    const stored: StoredAiSettings = {
      version: 3,
      aiProvider: normalized.aiProvider,
      ...optionalValue("openaiModel", normalized.openaiModel),
      ...optionalValue("openaiModelName", normalized.openaiModelName),
      ...optionalThinkingValue("openaiThinkingLevel", normalized.openaiThinkingLevel),
      ...optionalValue("geminiModel", normalized.geminiModel),
      ...optionalValue("geminiModelName", normalized.geminiModelName),
      ...optionalThinkingValue("geminiThinkingLevel", normalized.geminiThinkingLevel),
      ...optionalValue("anthropicModel", normalized.anthropicModel),
      ...optionalValue("anthropicModelName", normalized.anthropicModelName),
      ...optionalThinkingValue("anthropicThinkingLevel", normalized.anthropicThinkingLevel),
    };
    await this.values.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(stored));
    return normalized;
  }
}

function parseStoredSettings(value: unknown): StoredAiSettings {
  if (value === undefined || value === null) {
    return { version: 3, aiProvider: "raycast" };
  }
  if (typeof value !== "string") {
    throw new Error("Stored AI provider settings are invalid");
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) ||
      !isAiProvider(parsed.aiProvider)
    ) {
      throw new Error("Stored AI provider settings are invalid");
    }
    return {
      version: 3,
      aiProvider: parsed.aiProvider,
      ...optionalString("openaiModel", parsed.openaiModel),
      ...(parsed.version !== 1 ? optionalString("openaiModelName", parsed.openaiModelName) : {}),
      ...(parsed.version === 3 ? optionalThinkingLevel("openaiThinkingLevel", parsed.openaiThinkingLevel) : {}),
      ...optionalString("geminiModel", parsed.geminiModel),
      ...(parsed.version !== 1 ? optionalString("geminiModelName", parsed.geminiModelName) : {}),
      ...(parsed.version === 3 ? optionalThinkingLevel("geminiThinkingLevel", parsed.geminiThinkingLevel) : {}),
      ...optionalString("anthropicModel", parsed.anthropicModel),
      ...(parsed.version !== 1 ? optionalString("anthropicModelName", parsed.anthropicModelName) : {}),
      ...(parsed.version === 3 ? optionalThinkingLevel("anthropicThinkingLevel", parsed.anthropicThinkingLevel) : {}),
    };
  } catch (error: unknown) {
    throw new Error("Stored AI provider settings are invalid", { cause: error });
  }
}

function normalizeSettings(settings: AiPreferenceValues): AiPreferenceValues {
  return {
    aiProvider: settings.aiProvider,
    ...optionalValue("openaiApiKey", trimmed(settings.openaiApiKey)),
    ...optionalValue("openaiModel", trimmed(settings.openaiModel)),
    ...optionalValue("openaiModelName", trimmed(settings.openaiModelName)),
    ...optionalThinkingValue("openaiThinkingLevel", settings.openaiThinkingLevel),
    ...optionalValue("geminiApiKey", trimmed(settings.geminiApiKey)),
    ...optionalValue("geminiModel", trimmed(settings.geminiModel)),
    ...optionalValue("geminiModelName", trimmed(settings.geminiModelName)),
    ...optionalThinkingValue("geminiThinkingLevel", settings.geminiThinkingLevel),
    ...optionalValue("anthropicApiKey", trimmed(settings.anthropicApiKey)),
    ...optionalValue("anthropicModel", trimmed(settings.anthropicModel)),
    ...optionalValue("anthropicModelName", trimmed(settings.anthropicModelName)),
    ...optionalThinkingValue("anthropicThinkingLevel", settings.anthropicThinkingLevel),
  };
}

function apiKeyFor(settings: AiPreferenceValues, provider: ExternalAiProvider): string | undefined {
  switch (provider) {
    case "openai":
      return settings.openaiApiKey;
    case "gemini":
      return settings.geminiApiKey;
    case "anthropic":
      return settings.anthropicApiKey;
  }
}

function optionalString<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "string") {
    throw new Error(`Stored AI setting ${key} is invalid`);
  }
  return { [key]: value } as Record<Key, string>;
}

function optionalValue<Key extends string>(key: Key, value: string | undefined): Partial<Record<Key, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, string>);
}

function optionalThinkingLevel<Key extends string>(key: Key, value: unknown): Partial<Record<Key, AiThinkingLevel>> {
  if (value === undefined) {
    return {};
  }
  if (!isAiThinkingLevel(value)) {
    throw new Error(`Stored AI setting ${key} is invalid`);
  }
  return { [key]: value } as Record<Key, AiThinkingLevel>;
}

function optionalThinkingValue<Key extends string>(
  key: Key,
  value: AiThinkingLevel | undefined
): Partial<Record<Key, AiThinkingLevel>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, AiThinkingLevel>);
}

function trimmed(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isAiProvider(value: unknown): value is AiProvider {
  return value === "raycast" || value === "openai" || value === "gemini" || value === "anthropic";
}

function isAiThinkingLevel(value: unknown): value is AiThinkingLevel {
  return (
    typeof value === "string" &&
    (value === "none" ||
      value === "minimal" ||
      value === "low" ||
      value === "medium" ||
      value === "high" ||
      value === "xhigh" ||
      value === "max")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
