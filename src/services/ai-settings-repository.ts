import type { AiPreferenceValues, AiProvider } from "./ai-provider";
import type { AiThinkingLevel } from "./ai-thinking";

const SETTINGS_STORAGE_KEY = "ai-provider-settings-v1";
const EXTERNAL_PROVIDERS = ["openai", "gemini", "anthropic"] as const;
const SECRET_PROVIDERS = [...EXTERNAL_PROVIDERS, "custom-api-key", "custom"] as const;

type ExternalAiProvider = (typeof EXTERNAL_PROVIDERS)[number];
type SecretProvider = ExternalAiProvider | "custom-api-key" | "custom";

export interface AiSettingsValueStore {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface AiSettingsSecretStore {
  getSecret(provider: SecretProvider): Promise<string | undefined>;
  setSecret(provider: SecretProvider, value: string | undefined): Promise<void>;
}

type StoredAiSettings = {
  readonly version: 6;
  readonly aiProvider: AiProvider;
  readonly raycastModel?: string;
  readonly raycastModelName?: string;
  readonly openaiModel?: string;
  readonly openaiModelName?: string;
  readonly openaiThinkingLevel?: AiThinkingLevel;
  readonly openaiMaxOutputTokens?: number;
  readonly geminiModel?: string;
  readonly geminiModelName?: string;
  readonly geminiThinkingLevel?: AiThinkingLevel;
  readonly geminiMaxOutputTokens?: number;
  readonly anthropicModel?: string;
  readonly anthropicModelName?: string;
  readonly anthropicThinkingLevel?: AiThinkingLevel;
  readonly anthropicMaxOutputTokens?: number;
  readonly customProviderName?: string;
  readonly customBaseUrl?: string;
  readonly customModel?: string;
  readonly customThinkingLevel?: AiThinkingLevel;
  readonly customMaxOutputTokens?: number;
};

export class AiSettingsRepository {
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly values: AiSettingsValueStore,
    private readonly secrets: AiSettingsSecretStore
  ) {}

  async get(): Promise<AiPreferenceValues> {
    const [storedValue, openaiApiKey, geminiApiKey, anthropicApiKey, customApiKey, customHeadersJson] =
      await Promise.all([
        this.values.getItem(SETTINGS_STORAGE_KEY),
        this.secrets.getSecret("openai"),
        this.secrets.getSecret("gemini"),
        this.secrets.getSecret("anthropic"),
        this.secrets.getSecret("custom-api-key"),
        this.secrets.getSecret("custom"),
      ]);
    const stored = parseStoredSettings(storedValue);
    return {
      aiProvider: stored.aiProvider,
      ...optionalValue("raycastModel", stored.raycastModel),
      ...optionalValue("raycastModelName", stored.raycastModelName),
      ...optionalValue("openaiApiKey", openaiApiKey),
      ...optionalValue("openaiModel", stored.openaiModel),
      ...optionalValue("openaiModelName", stored.openaiModelName),
      ...optionalThinkingValue("openaiThinkingLevel", stored.openaiThinkingLevel),
      ...optionalPositiveInteger("openaiMaxOutputTokens", stored.openaiMaxOutputTokens),
      ...optionalValue("geminiApiKey", geminiApiKey),
      ...optionalValue("geminiModel", stored.geminiModel),
      ...optionalValue("geminiModelName", stored.geminiModelName),
      ...optionalThinkingValue("geminiThinkingLevel", stored.geminiThinkingLevel),
      ...optionalPositiveInteger("geminiMaxOutputTokens", stored.geminiMaxOutputTokens),
      ...optionalValue("anthropicApiKey", anthropicApiKey),
      ...optionalValue("anthropicModel", stored.anthropicModel),
      ...optionalValue("anthropicModelName", stored.anthropicModelName),
      ...optionalThinkingValue("anthropicThinkingLevel", stored.anthropicThinkingLevel),
      ...optionalPositiveInteger("anthropicMaxOutputTokens", stored.anthropicMaxOutputTokens),
      ...optionalValue("customProviderName", stored.customProviderName),
      ...optionalValue("customBaseUrl", stored.customBaseUrl),
      ...optionalValue("customModel", stored.customModel),
      ...optionalThinkingValue("customThinkingLevel", stored.customThinkingLevel),
      ...optionalPositiveInteger("customMaxOutputTokens", stored.customMaxOutputTokens),
      ...optionalValue("customApiKey", customApiKey),
      ...optionalValue("customHeadersJson", customHeadersJson),
    };
  }

  save(settings: AiPreferenceValues): Promise<AiPreferenceValues> {
    const operation = this.saveQueue.then(() => this.saveTransaction(settings));
    this.saveQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private async saveTransaction(settings: AiPreferenceValues): Promise<AiPreferenceValues> {
    const normalized = normalizeSettings(settings);
    const stored: StoredAiSettings = {
      version: 6,
      aiProvider: normalized.aiProvider,
      ...optionalValue("raycastModel", normalized.raycastModel),
      ...optionalValue("raycastModelName", normalized.raycastModelName),
      ...optionalValue("openaiModel", normalized.openaiModel),
      ...optionalValue("openaiModelName", normalized.openaiModelName),
      ...optionalThinkingValue("openaiThinkingLevel", normalized.openaiThinkingLevel),
      ...optionalPositiveInteger("openaiMaxOutputTokens", normalized.openaiMaxOutputTokens),
      ...optionalValue("geminiModel", normalized.geminiModel),
      ...optionalValue("geminiModelName", normalized.geminiModelName),
      ...optionalThinkingValue("geminiThinkingLevel", normalized.geminiThinkingLevel),
      ...optionalPositiveInteger("geminiMaxOutputTokens", normalized.geminiMaxOutputTokens),
      ...optionalValue("anthropicModel", normalized.anthropicModel),
      ...optionalValue("anthropicModelName", normalized.anthropicModelName),
      ...optionalThinkingValue("anthropicThinkingLevel", normalized.anthropicThinkingLevel),
      ...optionalPositiveInteger("anthropicMaxOutputTokens", normalized.anthropicMaxOutputTokens),
      ...optionalValue("customProviderName", normalized.customProviderName),
      ...optionalValue("customBaseUrl", normalized.customBaseUrl),
      ...optionalValue("customModel", normalized.customModel),
      ...optionalThinkingValue("customThinkingLevel", normalized.customThinkingLevel),
      ...optionalPositiveInteger("customMaxOutputTokens", normalized.customMaxOutputTokens),
    };
    const [previousStoredValue, ...previousSecretValues] = await Promise.all([
      this.values.getItem(SETTINGS_STORAGE_KEY),
      ...SECRET_PROVIDERS.map((provider) => this.secrets.getSecret(provider)),
    ]);
    const previousSecrets = new Map(SECRET_PROVIDERS.map((provider, index) => [provider, previousSecretValues[index]]));
    const secretWrites = await Promise.allSettled(
      SECRET_PROVIDERS.map((provider) => this.secrets.setSecret(provider, secretFor(normalized, provider)))
    );
    const secretFailure = secretWrites.find((result) => result.status === "rejected");
    if (secretFailure) {
      await rollbackOrThrow(secretFailure.reason, this.restoreSecrets(previousSecrets));
    }
    try {
      await this.values.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(stored));
    } catch (error: unknown) {
      await rollbackOrThrow(
        error,
        this.restoreSecrets(previousSecrets),
        restoreStoredValue(this.values, previousStoredValue)
      );
    }
    return normalized;
  }

  private async restoreSecrets(previousSecrets: ReadonlyMap<SecretProvider, string | undefined>): Promise<void> {
    const results = await Promise.allSettled(
      SECRET_PROVIDERS.map((provider) => this.secrets.setSecret(provider, previousSecrets.get(provider)))
    );
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        "Could not restore AI secrets"
      );
    }
  }
}

async function restoreStoredValue(values: AiSettingsValueStore, previousValue: unknown): Promise<void> {
  if (typeof previousValue === "string") {
    await values.setItem(SETTINGS_STORAGE_KEY, previousValue);
  } else {
    await values.removeItem(SETTINGS_STORAGE_KEY);
  }
}

async function rollbackOrThrow(error: unknown, ...rollbacks: readonly Promise<void>[]): Promise<never> {
  const results = await Promise.allSettled(rollbacks);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new Error("Could not save AI settings and rollback failed", {
      cause: new AggregateError([error, ...failures.map((failure) => failure.reason)]),
    });
  }
  throw error;
}

function parseStoredSettings(value: unknown): StoredAiSettings {
  if (value === undefined || value === null) {
    return { version: 6, aiProvider: "raycast" };
  }
  if (typeof value !== "string") {
    throw new Error("Stored AI provider settings are invalid");
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      (parsed.version !== 1 &&
        parsed.version !== 2 &&
        parsed.version !== 3 &&
        parsed.version !== 4 &&
        parsed.version !== 5 &&
        parsed.version !== 6) ||
      !isAiProvider(parsed.aiProvider)
    ) {
      throw new Error("Stored AI provider settings are invalid");
    }
    return {
      version: 6,
      aiProvider: parsed.aiProvider,
      ...(parsed.version === 5 || parsed.version === 6 ? optionalString("raycastModel", parsed.raycastModel) : {}),
      ...(parsed.version === 5 || parsed.version === 6
        ? optionalString("raycastModelName", parsed.raycastModelName)
        : {}),
      ...optionalString("openaiModel", parsed.openaiModel),
      ...(parsed.version !== 1 ? optionalString("openaiModelName", parsed.openaiModelName) : {}),
      ...(parsed.version === 3 || parsed.version === 4 || parsed.version === 5 || parsed.version === 6
        ? optionalThinkingLevel("openaiThinkingLevel", parsed.openaiThinkingLevel)
        : {}),
      ...(parsed.version === 6 ? optionalPositiveInteger("openaiMaxOutputTokens", parsed.openaiMaxOutputTokens) : {}),
      ...optionalString("geminiModel", parsed.geminiModel),
      ...(parsed.version !== 1 ? optionalString("geminiModelName", parsed.geminiModelName) : {}),
      ...(parsed.version === 3 || parsed.version === 4 || parsed.version === 5 || parsed.version === 6
        ? optionalThinkingLevel("geminiThinkingLevel", parsed.geminiThinkingLevel)
        : {}),
      ...(parsed.version === 6 ? optionalPositiveInteger("geminiMaxOutputTokens", parsed.geminiMaxOutputTokens) : {}),
      ...optionalString("anthropicModel", parsed.anthropicModel),
      ...(parsed.version !== 1 ? optionalString("anthropicModelName", parsed.anthropicModelName) : {}),
      ...(parsed.version === 3 || parsed.version === 4 || parsed.version === 5 || parsed.version === 6
        ? optionalThinkingLevel("anthropicThinkingLevel", parsed.anthropicThinkingLevel)
        : {}),
      ...(parsed.version === 6
        ? optionalPositiveInteger("anthropicMaxOutputTokens", parsed.anthropicMaxOutputTokens)
        : {}),
      ...(parsed.version === 4 || parsed.version === 5 || parsed.version === 6
        ? optionalString("customProviderName", parsed.customProviderName)
        : {}),
      ...(parsed.version === 4 || parsed.version === 5 || parsed.version === 6
        ? optionalString("customBaseUrl", parsed.customBaseUrl)
        : {}),
      ...(parsed.version === 4 || parsed.version === 5 || parsed.version === 6
        ? optionalString("customModel", parsed.customModel)
        : {}),
      ...(parsed.version === 5 || parsed.version === 6
        ? optionalThinkingLevel("customThinkingLevel", parsed.customThinkingLevel)
        : {}),
      ...(parsed.version === 6 ? optionalPositiveInteger("customMaxOutputTokens", parsed.customMaxOutputTokens) : {}),
    };
  } catch (error: unknown) {
    throw new Error("Stored AI provider settings are invalid", { cause: error });
  }
}

function normalizeSettings(settings: AiPreferenceValues): AiPreferenceValues {
  return {
    aiProvider: settings.aiProvider,
    ...optionalValue("raycastModel", trimmed(settings.raycastModel)),
    ...optionalValue("raycastModelName", trimmed(settings.raycastModelName)),
    ...optionalValue("openaiApiKey", trimmed(settings.openaiApiKey)),
    ...optionalValue("openaiModel", trimmed(settings.openaiModel)),
    ...optionalValue("openaiModelName", trimmed(settings.openaiModelName)),
    ...optionalThinkingValue("openaiThinkingLevel", settings.openaiThinkingLevel),
    ...optionalPositiveInteger("openaiMaxOutputTokens", settings.openaiMaxOutputTokens),
    ...optionalValue("geminiApiKey", trimmed(settings.geminiApiKey)),
    ...optionalValue("geminiModel", trimmed(settings.geminiModel)),
    ...optionalValue("geminiModelName", trimmed(settings.geminiModelName)),
    ...optionalThinkingValue("geminiThinkingLevel", settings.geminiThinkingLevel),
    ...optionalPositiveInteger("geminiMaxOutputTokens", settings.geminiMaxOutputTokens),
    ...optionalValue("anthropicApiKey", trimmed(settings.anthropicApiKey)),
    ...optionalValue("anthropicModel", trimmed(settings.anthropicModel)),
    ...optionalValue("anthropicModelName", trimmed(settings.anthropicModelName)),
    ...optionalThinkingValue("anthropicThinkingLevel", settings.anthropicThinkingLevel),
    ...optionalPositiveInteger("anthropicMaxOutputTokens", settings.anthropicMaxOutputTokens),
    ...optionalValue("customProviderName", trimmed(settings.customProviderName)),
    ...optionalValue("customBaseUrl", trimmed(settings.customBaseUrl)),
    ...optionalValue("customModel", trimmed(settings.customModel)),
    ...optionalThinkingValue("customThinkingLevel", settings.customThinkingLevel),
    ...optionalPositiveInteger("customMaxOutputTokens", settings.customMaxOutputTokens),
    ...optionalValue("customApiKey", trimmed(settings.customApiKey)),
    ...optionalValue("customHeadersJson", trimmed(settings.customHeadersJson)),
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

function secretFor(settings: AiPreferenceValues, provider: SecretProvider): string | undefined {
  if (provider === "custom") {
    return settings.customHeadersJson;
  }
  if (provider === "custom-api-key") {
    return settings.customApiKey;
  }
  return apiKeyFor(settings, provider);
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

function optionalPositiveInteger<Key extends string>(key: Key, value: unknown): Partial<Record<Key, number>> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Stored AI setting ${key} is invalid`);
  }
  return { [key]: value } as Record<Key, number>;
}

function trimmed(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isAiProvider(value: unknown): value is AiProvider {
  return value === "raycast" || value === "openai" || value === "gemini" || value === "anthropic" || value === "custom";
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
