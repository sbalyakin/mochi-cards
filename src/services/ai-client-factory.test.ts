import { describe, expect, it, vi } from "vitest";

import { createAiClient } from "./ai-client-factory";
import type { AiFetchLike } from "./ai-http-client";
import { AnthropicAiClient } from "./anthropic-ai-client";
import { CustomAiClient } from "./custom-ai-client";
import { GeminiAiClient } from "./gemini-ai-client";
import { OpenAiAiClient } from "./openai-ai-client";
import { RaycastAiClient } from "./raycast-ai-client";

vi.mock("./raycast-ai-client", () => ({
  RaycastAiClient: class MockRaycastAiClient {
    async ask(): Promise<string> {
      return "mock response";
    }
  },
}));

describe("createAiClient", () => {
  it("creates the default Raycast adapter", () => {
    expect(createAiClient({ aiProvider: "raycast" })).toBeInstanceOf(RaycastAiClient);
  });

  it.each([
    ["openai", OpenAiAiClient],
    ["gemini", GeminiAiClient],
    ["anthropic", AnthropicAiClient],
  ] as const)("creates the selected %s adapter", (aiProvider, Client) => {
    const preferences = {
      aiProvider,
      openaiApiKey: "key",
      openaiModel: "model",
      geminiApiKey: "key",
      geminiModel: "model",
      anthropicApiKey: "key",
      anthropicModel: "model",
    };

    expect(createAiClient(preferences)).toBeInstanceOf(Client);
  });

  it("trims the API key and model ID", async () => {
    const fetch = vi
      .fn<AiFetchLike>()
      .mockResolvedValue(
        new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: "answer" }] }] }))
      );
    const client = createAiClient(
      { aiProvider: "openai", openaiApiKey: "  secret-key  ", openaiModel: "  custom/model  " },
      { fetch }
    );

    await client.ask("prompt");

    const [, init] = fetch.mock.calls[0];
    expect(init?.headers).toMatchObject({ Authorization: "Bearer secret-key" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "custom/model" });
  });

  it.each(["openai", "gemini", "anthropic"] as const)("rejects a missing %s API key", (aiProvider) => {
    expect(() => createAiClient({ aiProvider, [`${aiProvider}Model`]: "model" })).toThrowError(
      expect.objectContaining({ kind: "configuration", provider: aiProvider })
    );
  });

  it.each(["openai", "gemini", "anthropic"] as const)("rejects a missing %s model ID", (aiProvider) => {
    expect(() => createAiClient({ aiProvider, [`${aiProvider}ApiKey`]: "key" })).toThrowError(
      expect.objectContaining({ kind: "configuration", provider: aiProvider })
    );
  });

  it("creates a custom adapter with a base URL, model, and headers", async () => {
    const fetch = vi
      .fn<AiFetchLike>()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }] })));
    const client = createAiClient(
      {
        aiProvider: "custom",
        customProviderName: "Ollama",
        customBaseUrl: "http://localhost:11434/v1/",
        customModel: "  llama3.1  ",
        customApiKey: "  sk-1  ",
        customHeadersJson: '{"X-Organization": "team"}',
      },
      { fetch }
    );

    expect(client).toBeInstanceOf(CustomAiClient);
    await expect(client.ask("prompt")).resolves.toBe("answer");

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-1", "X-Organization": "team" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "llama3.1" });
  });

  it("keeps an Authorization header from additional JSON when no API key is configured", async () => {
    const fetch = vi
      .fn<AiFetchLike>()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }] })));
    const client = createAiClient(
      {
        aiProvider: "custom",
        customBaseUrl: "http://localhost:11434/v1",
        customModel: "llama3.1",
        customHeadersJson: '{"Authorization": "Bearer existing"}',
      },
      { fetch }
    );

    await client.ask("prompt");

    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer existing" });
  });

  it("creates a custom adapter without headers or a provider name", () => {
    expect(
      createAiClient({ aiProvider: "custom", customBaseUrl: "http://localhost:11434/v1", customModel: "llama3.1" })
    ).toBeInstanceOf(CustomAiClient);
  });

  it("rejects a missing custom Base URL", () => {
    expect(() => createAiClient({ aiProvider: "custom", customModel: "llama3.1" })).toThrowError(
      expect.objectContaining({ kind: "configuration", provider: "custom" })
    );
  });

  it("rejects a missing custom model ID", () => {
    expect(() => createAiClient({ aiProvider: "custom", customBaseUrl: "http://localhost:11434/v1" })).toThrowError(
      expect.objectContaining({ kind: "configuration", provider: "custom" })
    );
  });

  it("rejects malformed custom headers JSON", () => {
    expect(() =>
      createAiClient({
        aiProvider: "custom",
        customBaseUrl: "http://localhost:11434/v1",
        customModel: "llama3.1",
        customHeadersJson: "not json",
      })
    ).toThrowError(expect.objectContaining({ kind: "configuration", provider: "custom" }));
  });
});
