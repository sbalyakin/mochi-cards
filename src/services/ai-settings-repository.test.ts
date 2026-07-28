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
      geminiApiKey: "  gemini-key  ",
      geminiModel: "  gemini-model  ",
      geminiModelName: "  Gemini Model  ",
      anthropicApiKey: "  anthropic-key  ",
      anthropicModel: "  anthropic-model  ",
      anthropicModelName: "  Claude Model  ",
    });

    await expect(repository.get()).resolves.toEqual({
      aiProvider: "openai",
      openaiApiKey: "openai-key",
      openaiModel: "openai-model",
      openaiModelName: "OpenAI Model",
      geminiApiKey: "gemini-key",
      geminiModel: "gemini-model",
      geminiModelName: "Gemini Model",
      anthropicApiKey: "anthropic-key",
      anthropicModel: "anthropic-model",
      anthropicModelName: "Claude Model",
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
});

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
