import type { AiPreferenceValues, AiProvider } from "./ai-provider";

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
  readonly version: 2;
  readonly aiProvider: AiProvider;
  readonly openaiModel?: string;
  readonly openaiModelName?: string;
  readonly geminiModel?: string;
  readonly geminiModelName?: string;
  readonly anthropicModel?: string;
  readonly anthropicModelName?: string;
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
      ...optionalValue("geminiApiKey", geminiApiKey),
      ...optionalValue("geminiModel", stored.geminiModel),
      ...optionalValue("geminiModelName", stored.geminiModelName),
      ...optionalValue("anthropicApiKey", anthropicApiKey),
      ...optionalValue("anthropicModel", stored.anthropicModel),
      ...optionalValue("anthropicModelName", stored.anthropicModelName),
    };
  }

  async save(settings: AiPreferenceValues): Promise<AiPreferenceValues> {
    const normalized = normalizeSettings(settings);
    await Promise.all(
      EXTERNAL_PROVIDERS.map((provider) => this.secrets.setSecret(provider, apiKeyFor(normalized, provider)))
    );
    const stored: StoredAiSettings = {
      version: 2,
      aiProvider: normalized.aiProvider,
      ...optionalValue("openaiModel", normalized.openaiModel),
      ...optionalValue("openaiModelName", normalized.openaiModelName),
      ...optionalValue("geminiModel", normalized.geminiModel),
      ...optionalValue("geminiModelName", normalized.geminiModelName),
      ...optionalValue("anthropicModel", normalized.anthropicModel),
      ...optionalValue("anthropicModelName", normalized.anthropicModelName),
    };
    await this.values.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(stored));
    return normalized;
  }
}

function parseStoredSettings(value: unknown): StoredAiSettings {
  if (value === undefined || value === null) {
    return { version: 2, aiProvider: "raycast" };
  }
  if (typeof value !== "string") {
    throw new Error("Stored AI provider settings are invalid");
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || (parsed.version !== 1 && parsed.version !== 2) || !isAiProvider(parsed.aiProvider)) {
      throw new Error("Stored AI provider settings are invalid");
    }
    return {
      version: 2,
      aiProvider: parsed.aiProvider,
      ...optionalString("openaiModel", parsed.openaiModel),
      ...(parsed.version === 2 ? optionalString("openaiModelName", parsed.openaiModelName) : {}),
      ...optionalString("geminiModel", parsed.geminiModel),
      ...(parsed.version === 2 ? optionalString("geminiModelName", parsed.geminiModelName) : {}),
      ...optionalString("anthropicModel", parsed.anthropicModel),
      ...(parsed.version === 2 ? optionalString("anthropicModelName", parsed.anthropicModelName) : {}),
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
    ...optionalValue("geminiApiKey", trimmed(settings.geminiApiKey)),
    ...optionalValue("geminiModel", trimmed(settings.geminiModel)),
    ...optionalValue("geminiModelName", trimmed(settings.geminiModelName)),
    ...optionalValue("anthropicApiKey", trimmed(settings.anthropicApiKey)),
    ...optionalValue("anthropicModel", trimmed(settings.anthropicModel)),
    ...optionalValue("anthropicModelName", trimmed(settings.anthropicModelName)),
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

function trimmed(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isAiProvider(value: unknown): value is AiProvider {
  return value === "raycast" || value === "openai" || value === "gemini" || value === "anthropic";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
