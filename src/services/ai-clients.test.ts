import { describe, expect, it, vi } from "vitest";

import { AnthropicAiClient } from "./anthropic-ai-client";
import type { AiFetchLike } from "./ai-http-client";
import type { AiProvider } from "./ai-provider";
import { GeminiAiClient } from "./gemini-ai-client";
import { OpenAiAiClient } from "./openai-ai-client";

const API_KEY = "secret-api-key";
const MODEL = "model/custom";
const PROMPT = "private prompt";

type TestClient = { ask(prompt: string, signal?: AbortSignal): Promise<string> };

type AdapterCase = {
  readonly provider: Exclude<AiProvider, "raycast">;
  readonly create: (fetch: AiFetchLike, timeoutMs?: number) => TestClient;
  readonly url: string;
  readonly authorizationHeader: Readonly<Record<string, string>>;
  readonly expectedBody: unknown;
  readonly singleResponse: unknown;
  readonly multipleResponse: unknown;
};

const adapters: readonly AdapterCase[] = [
  {
    provider: "openai",
    create: (fetch, timeoutMs) => new OpenAiAiClient(API_KEY, MODEL, fetch, timeoutMs),
    url: "https://api.openai.com/v1/responses",
    authorizationHeader: { Authorization: `Bearer ${API_KEY}` },
    expectedBody: { model: MODEL, input: PROMPT, store: false, max_output_tokens: 4096 },
    singleResponse: { output: [{ content: [{ type: "output_text", text: "one" }] }] },
    multipleResponse: {
      output: [
        {
          content: [
            { type: "reasoning", text: "ignored" },
            { type: "output_text", text: "one" },
          ],
        },
        { content: [{ type: "output_text", text: "two" }] },
      ],
    },
  },
  {
    provider: "gemini",
    create: (fetch, timeoutMs) => new GeminiAiClient(API_KEY, MODEL, fetch, timeoutMs),
    url: "https://generativelanguage.googleapis.com/v1beta/models/model%2Fcustom:generateContent",
    authorizationHeader: { "x-goog-api-key": API_KEY },
    expectedBody: {
      contents: [{ role: "user", parts: [{ text: PROMPT }] }],
      generationConfig: { maxOutputTokens: 4096 },
    },
    singleResponse: { candidates: [{ content: { parts: [{ text: "one" }] } }] },
    multipleResponse: {
      candidates: [
        { content: { parts: [{ text: "one" }, { inlineData: "ignored" }, { text: "two" }] } },
        { content: { parts: [{ text: "ignored candidate" }] } },
      ],
    },
  },
  {
    provider: "anthropic",
    create: (fetch, timeoutMs) => new AnthropicAiClient(API_KEY, MODEL, fetch, timeoutMs),
    url: "https://api.anthropic.com/v1/messages",
    authorizationHeader: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    expectedBody: {
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: PROMPT }],
    },
    singleResponse: { content: [{ type: "text", text: "one" }] },
    multipleResponse: {
      content: [
        { type: "thinking", thinking: "ignored" },
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
    },
  },
];

describe.each(adapters)("$provider AI client", (adapter) => {
  it("sends the expected POST request", async () => {
    const fetch = successfulFetch(adapter.singleResponse);

    await expect(adapter.create(fetch).ask(PROMPT)).resolves.toBe("one");

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(adapter.url);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json", ...adapter.authorizationHeader });
    expect(JSON.parse(String(init?.body))).toEqual(adapter.expectedBody);
  });

  it("combines multiple text blocks", async () => {
    await expect(adapter.create(successfulFetch(adapter.multipleResponse)).ask(PROMPT)).resolves.toBe("onetwo");
  });

  it("rejects an empty response", async () => {
    await expect(adapter.create(successfulFetch({})).ask(PROMPT)).rejects.toMatchObject({
      provider: adapter.provider,
      kind: "invalid-response",
    });
  });

  it("rejects malformed JSON", async () => {
    const fetch = vi.fn<AiFetchLike>().mockResolvedValue(new Response("not json"));

    await expect(adapter.create(fetch).ask(PROMPT)).rejects.toMatchObject({
      provider: adapter.provider,
      kind: "invalid-response",
    });
  });

  it.each([
    [401, "authentication"],
    [403, "authentication"],
    [429, "rate-limit"],
    [400, "request-failed"],
    [404, "request-failed"],
    [500, "provider-unavailable"],
  ] as const)("maps HTTP %s to %s", async (status, kind) => {
    const response = JSON.stringify({ error: { message: `Unknown model ${MODEL}` } });
    const fetch = vi.fn<AiFetchLike>().mockResolvedValue(new Response(response, { status }));

    await expect(adapter.create(fetch).ask(PROMPT)).rejects.toMatchObject({
      provider: adapter.provider,
      kind,
      status,
      ...(status === 400 || status === 404 ? { message: expect.stringContaining(`Unknown model ${MODEL}`) } : {}),
    });
  });

  it("normalizes network errors", async () => {
    const cause = new Error("socket failed");
    const fetch = vi.fn<AiFetchLike>().mockRejectedValue(cause);

    await expect(adapter.create(fetch).ask(PROMPT)).rejects.toMatchObject({
      provider: adapter.provider,
      kind: "request-failed",
      cause,
    });
  });

  it("times out the request", async () => {
    const fetch = abortablePendingFetch();

    await expect(adapter.create(fetch, 5).ask(PROMPT)).rejects.toMatchObject({
      provider: adapter.provider,
      kind: "timeout",
    });
  });

  it("distinguishes user cancellation", async () => {
    const controller = new AbortController();
    const request = adapter.create(abortablePendingFetch(), 1_000).ask(PROMPT, controller.signal);
    controller.abort(new Error("cancelled by user"));

    await expect(request).rejects.toMatchObject({ provider: adapter.provider, kind: "aborted" });
  });

  it("does not expose the API key or prompt in errors", async () => {
    const response = JSON.stringify({ error: { message: `Bad ${API_KEY}: ${PROMPT}` } });
    const fetch = vi.fn<AiFetchLike>().mockResolvedValue(new Response(response, { status: 400 }));

    let errorMessage = "";
    try {
      await adapter.create(fetch).ask(PROMPT);
    } catch (error: unknown) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).not.toContain(API_KEY);
    expect(errorMessage).not.toContain(PROMPT);
    expect(errorMessage.length).toBeLessThanOrEqual(300);
  });
});

function successfulFetch(body: unknown) {
  return vi.fn<AiFetchLike>().mockResolvedValue(new Response(JSON.stringify(body)));
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
