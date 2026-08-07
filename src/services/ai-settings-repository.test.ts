import { describe, expect, it } from "vitest";

import { AiSettingsRepository, type AiSettingsSecretStore, type AiSettingsValueStore } from "./ai-settings-repository";

describe("AiSettingsRepository", () => {
  it("defaults to Raycast AI", async () => {
    const fixture = stores();

    await expect(new AiSettingsRepository(fixture.values, fixture.secrets).get()).resolves.toEqual({
      aiProvider: "raycast",
    });
  });

  it("trims and restores settings for every provider", async () => {
    const fixture = stores();
    const repository = new AiSettingsRepository(fixture.values, fixture.secrets);

    await repository.save({
      aiProvider: "openai",
      openaiApiKey: "  openai-key  ",
      openaiModel: "  openai-model  ",
      openaiModelName: "  OpenAI Model  ",
      openaiThinkingLevel: "high",
      geminiApiKey: "  gemini-key  ",
      geminiModel: "  gemini-model  ",
      geminiModelName: "  Gemini Model  ",
      geminiThinkingLevel: "medium",
      anthropicApiKey: "  anthropic-key  ",
      anthropicModel: "  anthropic-model  ",
      anthropicModelName: "  Claude Model  ",
      anthropicThinkingLevel: "low",
    });

    await expect(repository.get()).resolves.toEqual({
      aiProvider: "openai",
      openaiApiKey: "openai-key",
      openaiModel: "openai-model",
      openaiModelName: "OpenAI Model",
      openaiThinkingLevel: "high",
      geminiApiKey: "gemini-key",
      geminiModel: "gemini-model",
      geminiModelName: "Gemini Model",
      geminiThinkingLevel: "medium",
      anthropicApiKey: "anthropic-key",
      anthropicModel: "anthropic-model",
      anthropicModelName: "Claude Model",
      anthropicThinkingLevel: "low",
    });
  });

  it("preserves provider settings when the selected provider changes", async () => {
    const fixture = stores();
    const repository = new AiSettingsRepository(fixture.values, fixture.secrets);
    await repository.save({ aiProvider: "openai", openaiApiKey: "key", openaiModel: "model" });
    const current = await repository.get();

    await repository.save({ ...current, aiProvider: "raycast" });

    await expect(repository.get()).resolves.toEqual({
      aiProvider: "raycast",
      openaiApiKey: "key",
      openaiModel: "model",
    });
  });

  it("rejects malformed persisted settings", async () => {
    const fixture = stores("not json");

    await expect(new AiSettingsRepository(fixture.values, fixture.secrets).get()).rejects.toThrow(
      "Stored AI provider settings are invalid"
    );
  });

  it("reads version 1 settings without a stored model name", async () => {
    const fixture = stores(
      JSON.stringify({ version: 1, aiProvider: "anthropic", anthropicModel: "claude-haiku-4-5-20251001" })
    );

    await expect(new AiSettingsRepository(fixture.values, fixture.secrets).get()).resolves.toEqual({
      aiProvider: "anthropic",
      anthropicModel: "claude-haiku-4-5-20251001",
    });
  });

  it("reads version 2 settings without a thinking level", async () => {
    const fixture = stores(JSON.stringify({ version: 2, aiProvider: "openai", openaiModel: "gpt-5" }));

    await expect(new AiSettingsRepository(fixture.values, fixture.secrets).get()).resolves.toEqual({
      aiProvider: "openai",
      openaiModel: "gpt-5",
    });
  });

  it("reads version 3 settings without a custom provider profile", async () => {
    const fixture = stores(
      JSON.stringify({ version: 3, aiProvider: "openai", openaiModel: "gpt-5", openaiThinkingLevel: "high" })
    );

    await expect(new AiSettingsRepository(fixture.values, fixture.secrets).get()).resolves.toEqual({
      aiProvider: "openai",
      openaiModel: "gpt-5",
      openaiThinkingLevel: "high",
    });
  });

  it("saves and restores a custom provider profile", async () => {
    const fixture = stores();
    const repository = new AiSettingsRepository(fixture.values, fixture.secrets);

    await repository.save({
      aiProvider: "custom",
      customProviderName: "  Ollama  ",
      customBaseUrl: "  http://localhost:11434/v1  ",
      customModel: "  llama3.1  ",
      customApiKey: "  sk-1  ",
      customHeadersJson: '  {"X-Organization": "team"}  ',
    });

    await expect(repository.get()).resolves.toEqual({
      aiProvider: "custom",
      customProviderName: "Ollama",
      customBaseUrl: "http://localhost:11434/v1",
      customModel: "llama3.1",
      customApiKey: "sk-1",
      customHeadersJson: '{"X-Organization": "team"}',
    });
  });

  it("preserves the custom provider profile when the selected provider changes", async () => {
    const fixture = stores();
    const repository = new AiSettingsRepository(fixture.values, fixture.secrets);
    await repository.save({
      aiProvider: "custom",
      customBaseUrl: "http://localhost:11434/v1",
      customModel: "llama3.1",
      customApiKey: "sk-1",
      customHeadersJson: '{"X-Organization": "team"}',
    });
    const current = await repository.get();

    await repository.save({ ...current, aiProvider: "raycast" });

    await expect(repository.get()).resolves.toEqual({
      aiProvider: "raycast",
      customBaseUrl: "http://localhost:11434/v1",
      customModel: "llama3.1",
      customApiKey: "sk-1",
      customHeadersJson: '{"X-Organization": "team"}',
    });
  });

  it("restores Keychain secrets when LocalStorage save fails", async () => {
    let storedValue = JSON.stringify({
      version: 4,
      aiProvider: "custom",
      customBaseUrl: "https://old.example/v1",
      customModel: "old-model",
    });
    const storedSecrets = new Map<string, string>([
      ["custom-api-key", "old-key"],
      ["custom", '{"X-Organization":"old"}'],
    ]);
    let failNextValueWrite = true;
    const values: AiSettingsValueStore = {
      async getItem() {
        return storedValue;
      },
      async setItem(_key, value) {
        storedValue = value;
        if (failNextValueWrite) {
          failNextValueWrite = false;
          throw new Error("LocalStorage failed");
        }
      },
      async removeItem() {
        storedValue = "";
      },
    };
    const secrets = mapSecretStore(storedSecrets);
    const repository = new AiSettingsRepository(values, secrets);

    await expect(
      repository.save({
        aiProvider: "custom",
        customBaseUrl: "https://new.example/v1",
        customModel: "new-model",
        customApiKey: "new-key",
        customHeadersJson: '{"X-Organization":"new"}',
      })
    ).rejects.toThrow("LocalStorage failed");

    await expect(repository.get()).resolves.toMatchObject({
      customBaseUrl: "https://old.example/v1",
      customApiKey: "old-key",
      customHeadersJson: '{"X-Organization":"old"}',
    });
  });

  it("restores all secrets after a partial Keychain failure", async () => {
    const initialValue = JSON.stringify({ version: 4, aiProvider: "openai", openaiModel: "old-model" });
    let storedValue = initialValue;
    const storedSecrets = new Map<string, string>([
      ["openai", "old-openai-key"],
      ["custom-api-key", "old-custom-key"],
      ["custom", '{"X-Organization":"old"}'],
    ]);
    let failCustomWrite = true;
    const values: AiSettingsValueStore = {
      async getItem() {
        return storedValue;
      },
      async setItem(_key, value) {
        storedValue = value;
      },
      async removeItem() {
        storedValue = "";
      },
    };
    const secrets: AiSettingsSecretStore = {
      async getSecret(provider) {
        return storedSecrets.get(provider);
      },
      async setSecret(provider, value) {
        if (value === undefined) {
          storedSecrets.delete(provider);
        } else {
          storedSecrets.set(provider, value);
        }
        if (provider === "custom" && failCustomWrite) {
          failCustomWrite = false;
          throw new Error("Keychain failed");
        }
      },
    };
    const repository = new AiSettingsRepository(values, secrets);

    await expect(
      repository.save({
        aiProvider: "custom",
        openaiApiKey: "new-openai-key",
        customBaseUrl: "https://new.example/v1",
        customModel: "new-model",
        customApiKey: "new-custom-key",
        customHeadersJson: '{"X-Organization":"new"}',
      })
    ).rejects.toThrow("Keychain failed");

    expect(storedValue).toBe(initialValue);
    expect(storedSecrets.get("openai")).toBe("old-openai-key");
    expect(storedSecrets.get("custom-api-key")).toBe("old-custom-key");
    expect(storedSecrets.get("custom")).toBe('{"X-Organization":"old"}');
  });

  it("serializes overlapping saves so a failed rollback cannot overwrite a later save", async () => {
    const initialValue = JSON.stringify({ version: 4, aiProvider: "custom", customModel: "initial" });
    let storedValue = initialValue;
    const storedSecrets = new Map<string, string>([["custom", "initial-secret"]]);
    let firstWriteStarted: (() => void) | undefined;
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteReached = new Promise<void>((resolve) => {
      firstWriteStarted = resolve;
    });
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let failFirstWrite = true;
    const values: AiSettingsValueStore = {
      async getItem() {
        return storedValue;
      },
      async setItem(_key, value) {
        const model = JSON.parse(value).customModel as string | undefined;
        if (model === "first" && failFirstWrite) {
          firstWriteStarted?.();
          await firstWriteGate;
          storedValue = value;
          failFirstWrite = false;
          throw new Error("first save failed");
        }
        storedValue = value;
      },
      async removeItem() {
        storedValue = "";
      },
    };
    const repository = new AiSettingsRepository(values, mapSecretStore(storedSecrets));
    const firstSave = repository.save({
      aiProvider: "custom",
      customModel: "first",
      customHeadersJson: "first-secret",
    });
    await firstWriteReached;

    const secondSave = repository.save({
      aiProvider: "custom",
      customModel: "second",
      customHeadersJson: "second-secret",
    });
    releaseFirstWrite?.();

    await expect(firstSave).rejects.toThrow("first save failed");
    await expect(secondSave).resolves.toMatchObject({ customModel: "second" });
    await expect(repository.get()).resolves.toMatchObject({
      customModel: "second",
      customHeadersJson: "second-secret",
    });
  });
});

function mapSecretStore(storedSecrets: Map<string, string>): AiSettingsSecretStore {
  return {
    async getSecret(provider) {
      return storedSecrets.get(provider);
    },
    async setSecret(provider, value) {
      if (value === undefined) {
        storedSecrets.delete(provider);
      } else {
        storedSecrets.set(provider, value);
      }
    },
  };
}

function stores(initialValue?: string): {
  readonly values: AiSettingsValueStore;
  readonly secrets: AiSettingsSecretStore;
} {
  let storedValue = initialValue;
  const storedSecrets = new Map<string, string>();
  return {
    values: {
      async getItem(): Promise<unknown> {
        return storedValue;
      },
      async setItem(_key, value): Promise<void> {
        storedValue = value;
      },
      async removeItem(): Promise<void> {
        storedValue = undefined;
      },
    },
    secrets: {
      async getSecret(provider): Promise<string | undefined> {
        return storedSecrets.get(provider);
      },
      async setSecret(provider, value): Promise<void> {
        if (value === undefined) {
          storedSecrets.delete(provider);
        } else {
          storedSecrets.set(provider, value);
        }
      },
    },
  };
}
