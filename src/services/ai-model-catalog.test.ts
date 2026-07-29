import { describe, expect, it, vi } from "vitest";

import type { AiFetchLike } from "./ai-http-client";
import { AiModelCatalog, normalizeSelectedModelId, sortClaudeModels, sortOpenAiModels } from "./ai-model-catalog";

const API_KEY = "secret-api-key";

describe("AiModelCatalog", () => {
  it("loads and sorts OpenAI models", async () => {
    const fetch = jsonFetch({ data: [{ id: "gpt-5-z" }, { id: "gpt-5-a" }] });

    await expect(new AiModelCatalog(fetch).list("openai", `  ${API_KEY}  `)).resolves.toEqual([
      { id: "gpt-5-a", group: "GPT-5" },
      { id: "gpt-5-z", group: "GPT-5" },
    ]);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect(init).toMatchObject({ method: "GET", headers: { Authorization: `Bearer ${API_KEY}` } });
    expect(init?.body).toBeUndefined();
  });

  it("loads all Gemini pages and keeps only text generateContent models", async () => {
    const fetch = queuedJsonFetch([
      {
        models: [
          {
            name: "models/gemini-pro",
            displayName: "Gemini Pro",
            supportedGenerationMethods: ["generateContent"],
          },
          { name: "models/embedding", supportedGenerationMethods: ["embedContent"] },
          {
            name: "models/gemini-2.5-flash-image",
            displayName: "Nano Banana",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
        nextPageToken: "next page",
      },
      {
        models: [
          { name: "models/gemini-3.1-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-2.0-flash-001", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
          { name: "models/gemma-4-31b-it", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.1-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.1-pro-preview-customtools", supportedGenerationMethods: ["generateContent"] },
        ],
      },
    ]);

    await expect(new AiModelCatalog(fetch).list("gemini", API_KEY)).resolves.toEqual([
      { id: "gemini-3.1-flash", group: "Gemini 3.1" },
      { id: "gemini-flash", group: "Other Models" },
      { id: "gemini-pro", displayName: "Gemini Pro", group: "Other Models" },
      { id: "gemma-4-31b-it", group: "Gemma" },
    ]);

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=next+page",
    ]);
    expect(fetch.mock.calls[0][1]?.headers).toEqual({ "x-goog-api-key": API_KEY });
  });

  it("loads all Anthropic pages", async () => {
    const fetch = queuedJsonFetch([
      {
        data: [
          { type: "model", id: "claude-opus-5", display_name: "Claude Opus 5" },
          { type: "model", id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
          { type: "model", id: "claude-z", display_name: "Claude Z" },
          { type: "model", id: "not-claude", display_name: "Not Claude" },
          { type: "other", id: "claude-not-a-model", display_name: "Not a model" },
        ],
        has_more: true,
        last_id: "claude-z",
      },
      { data: [{ type: "model", id: "claude-a", display_name: "Claude A" }], has_more: false },
    ]);

    await expect(new AiModelCatalog(fetch).list("anthropic", API_KEY)).resolves.toEqual([
      { id: "claude-opus-5", displayName: "Claude Opus 5", group: "Claude 5" },
      { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", group: "Claude 4.6" },
      { id: "claude-a", displayName: "Claude A", group: "Other Models" },
      { id: "claude-z", displayName: "Claude Z", group: "Other Models" },
    ]);

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.anthropic.com/v1/models?limit=1000",
      "https://api.anthropic.com/v1/models?limit=1000&after_id=claude-z",
    ]);
    expect(fetch.mock.calls[0][1]?.headers).toEqual({
      "anthropic-version": "2023-06-01",
      "x-api-key": API_KEY,
    });
  });

  it("keeps provider-reported thinking support", async () => {
    const geminiFetch = jsonFetch({
      models: [
        { name: "models/gemma-4-31b-it", supportedGenerationMethods: ["generateContent"], thinking: true },
        { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"], thinking: false },
      ],
    });
    const anthropicFetch = jsonFetch({
      data: [
        { type: "model", id: "claude-sonnet-4-6", capabilities: { thinking: { supported: true } } },
        { type: "model", id: "claude-haiku-4-5", capabilities: { thinking: { supported: false } } },
      ],
      has_more: false,
    });

    await expect(new AiModelCatalog(geminiFetch).list("gemini", API_KEY)).resolves.toEqual([
      { id: "gemini-2.0-flash", group: "Gemini 2.0", thinkingSupported: false },
      { id: "gemma-4-31b-it", group: "Gemma", thinkingSupported: true },
    ]);
    await expect(new AiModelCatalog(anthropicFetch).list("anthropic", API_KEY)).resolves.toEqual([
      { id: "claude-sonnet-4-6", group: "Claude 4.6", thinkingSupported: true },
      { id: "claude-haiku-4-5", group: "Claude 4.5", thinkingSupported: false },
    ]);
  });

  it.each(["openai", "gemini", "anthropic"] as const)("requires a %s API key", async (provider) => {
    await expect(new AiModelCatalog().list(provider, "  ")).rejects.toMatchObject({
      provider,
      kind: "configuration",
    });
  });

  it.each([
    [401, "authentication"],
    [403, "authentication"],
    [429, "rate-limit"],
    [500, "provider-unavailable"],
  ] as const)("maps HTTP %s to %s", async (status, kind) => {
    const fetch = vi
      .fn<AiFetchLike>()
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: `Rejected ${API_KEY}` } }), { status }));

    await expect(new AiModelCatalog(fetch).list("openai", API_KEY)).rejects.toMatchObject({
      provider: "openai",
      kind,
      status,
    });
  });

  it.each(["openai", "gemini", "anthropic"] as const)("rejects a malformed %s model list", async (provider) => {
    await expect(new AiModelCatalog(jsonFetch({ unexpected: [] })).list(provider, API_KEY)).rejects.toMatchObject({
      provider,
      kind: "invalid-response",
    });
  });

  it("rejects malformed JSON", async () => {
    const fetch = vi.fn<AiFetchLike>().mockResolvedValue(new Response("not json"));

    await expect(new AiModelCatalog(fetch).list("openai", API_KEY)).rejects.toMatchObject({
      provider: "openai",
      kind: "invalid-response",
    });
  });

  it("times out model loading", async () => {
    await expect(new AiModelCatalog(abortablePendingFetch(), 5).list("openai", API_KEY)).rejects.toMatchObject({
      provider: "openai",
      kind: "timeout",
    });
  });

  it("distinguishes user cancellation", async () => {
    const controller = new AbortController();
    const request = new AiModelCatalog(abortablePendingFetch(), 1_000).list("openai", API_KEY, controller.signal);
    controller.abort(new Error("cancelled by user"));

    await expect(request).rejects.toMatchObject({ provider: "openai", kind: "aborted" });
  });

  it("does not expose the API key in provider errors", async () => {
    const fetch = vi
      .fn<AiFetchLike>()
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: `Bad key ${API_KEY}` } }), { status: 400 }));

    await expect(errorText(new AiModelCatalog(fetch).list("openai", API_KEY))).resolves.not.toContain(API_KEY);
  });

  it("normalizes Gemini model resource names selected manually", () => {
    expect(normalizeSelectedModelId("gemini", " models/gemini-pro ")).toBe("gemini-pro");
    expect(normalizeSelectedModelId("openai", " gpt-5 ")).toBe("gpt-5");
  });

  it("keeps only current OpenAI text model families", async () => {
    const fetch = jsonFetch({
      data: [
        { id: "gpt-5" },
        { id: "gpt-5.6-sol" },
        { id: "gpt-5-2025-08-07" },
        { id: "gpt-5-codex" },
        { id: "gpt-5.4-pro-2026-03-05" },
        { id: "gpt-4o-mini" },
        { id: "o3" },
        { id: "gpt-3.5-turbo" },
        { id: "gpt-image-1" },
        { id: "gpt-4o-audio-preview" },
        { id: "gpt-4o-search-preview" },
        { id: "text-embedding-3-small" },
      ],
    });

    await expect(new AiModelCatalog(fetch).list("openai", API_KEY)).resolves.toEqual([
      { id: "gpt-5.6-sol", group: "GPT-5" },
      { id: "gpt-5", group: "GPT-5" },
      { id: "gpt-4o-mini", group: "GPT-4o" },
      { id: "o3", group: "Reasoning" },
    ]);
  });

  it("sorts OpenAI models from newer and higher tiers to older and smaller tiers", () => {
    expect(
      sortOpenAiModels([
        { id: "gpt-5" },
        { id: "gpt-5.6-luna" },
        { id: "gpt-5.5-pro" },
        { id: "gpt-5.6-sol" },
        { id: "gpt-5.6-terra" },
        { id: "gpt-5.5" },
        { id: "gpt-5-mini" },
      ]).map((model) => model.id)
    ).toEqual(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5-pro", "gpt-5.5", "gpt-5", "gpt-5-mini"]);
  });

  it("sorts Claude model versions from newest to oldest", () => {
    expect(sortClaudeModels([{ id: "claude-opus-4-8" }, { id: "claude-opus-5" }, { id: "claude-opus-4-6" }])).toEqual([
      { id: "claude-opus-5" },
      { id: "claude-opus-4-8" },
      { id: "claude-opus-4-6" },
    ]);
  });
});

function jsonFetch(body: unknown) {
  return vi.fn<AiFetchLike>().mockResolvedValue(new Response(JSON.stringify(body)));
}

function queuedJsonFetch(bodies: readonly unknown[]) {
  const fetch = vi.fn<AiFetchLike>();
  for (const body of bodies) {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(body)));
  }
  return fetch;
}

function abortablePendingFetch(): AiFetchLike {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

async function errorText(request: Promise<unknown>): Promise<string> {
  try {
    await request;
    return "";
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
