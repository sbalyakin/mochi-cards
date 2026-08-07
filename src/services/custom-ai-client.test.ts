import { describe, expect, it, vi } from "vitest";

import type { AiFetchLike } from "./ai-http-client";
import { CustomAiClient } from "./custom-ai-client";

const BASE_URL = "http://localhost:11434/v1";
const MODEL = "llama3.1";
const PROMPT = "private prompt";

describe("CustomAiClient", () => {
  it("sends the expected POST request", async () => {
    const fetch = successfulFetch({ choices: [{ message: { content: "answer" } }] });
    const headers = { Authorization: "Bearer sk-test" };

    await expect(new CustomAiClient(BASE_URL, MODEL, headers, "Ollama", fetch).ask(PROMPT)).resolves.toBe("answer");

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/chat/completions`);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-test", "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: MODEL,
      messages: [{ role: "user", content: PROMPT }],
      max_tokens: 4096,
    });
  });

  it("forces the Content-Type header even if a header tries to override it", async () => {
    const fetch = successfulFetch({ choices: [{ message: { content: "answer" } }] });
    const headers = { "Content-Type": "text/plain" };

    await new CustomAiClient(BASE_URL, MODEL, headers, "Ollama", fetch).ask(PROMPT);

    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("removes a case-variant Content-Type header instead of merging it", async () => {
    const fetch = successfulFetch({ choices: [{ message: { content: "answer" } }] });
    const headers = { "content-type": "text/plain", "CONTENT-TYPE": "text/html" };

    await new CustomAiClient(BASE_URL, MODEL, headers, "Ollama", fetch).ask(PROMPT);

    const sentHeaders = fetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(sentHeaders["Content-Type"]).toBe("application/json");
    expect(Object.keys(sentHeaders).filter((key) => key.toLocaleLowerCase() === "content-type")).toHaveLength(1);
  });

  it("returns only the first valid choice", async () => {
    const fetch = successfulFetch({
      choices: [{ message: { content: "one" } }, { message: { content: "two" } }],
    });

    await expect(new CustomAiClient(BASE_URL, MODEL, {}, "Ollama", fetch).ask(PROMPT)).resolves.toBe("one");
  });

  it("skips invalid choices before the first valid choice", async () => {
    const fetch = successfulFetch({
      choices: [{ message: {} }, { message: { content: "answer" } }, { message: { content: "ignored" } }],
    });

    await expect(new CustomAiClient(BASE_URL, MODEL, {}, "Ollama", fetch).ask(PROMPT)).resolves.toBe("answer");
  });

  it("rejects an empty response", async () => {
    const fetch = successfulFetch({ choices: [] });

    await expect(new CustomAiClient(BASE_URL, MODEL, {}, "Ollama", fetch).ask(PROMPT)).rejects.toMatchObject({
      provider: "custom",
      kind: "invalid-response",
      message: "Ollama returned no text",
    });
  });

  it("rejects malformed JSON", async () => {
    const fetch = vi.fn<AiFetchLike>().mockResolvedValue(new Response("not json"));

    await expect(new CustomAiClient(BASE_URL, MODEL, {}, "Ollama", fetch).ask(PROMPT)).rejects.toMatchObject({
      provider: "custom",
      kind: "invalid-response",
    });
  });

  it("rejects a response larger than 1 MB while streaming", async () => {
    const fetch = vi.fn<AiFetchLike>().mockResolvedValue(new Response("x".repeat(1024 * 1024 + 1)));

    await expect(new CustomAiClient(BASE_URL, MODEL, {}, "Ollama", fetch).ask(PROMPT)).rejects.toMatchObject({
      provider: "custom",
      kind: "invalid-response",
      message: "Ollama response exceeded the 1 MB limit",
    });
  });

  it("uses the display name in status errors", async () => {
    const fetch = vi.fn<AiFetchLike>().mockResolvedValue(new Response("", { status: 500 }));

    await expect(new CustomAiClient(BASE_URL, MODEL, {}, "Ollama", fetch).ask(PROMPT)).rejects.toMatchObject({
      provider: "custom",
      kind: "provider-unavailable",
      message: "Ollama is temporarily unavailable",
    });
  });

  it("suppresses custom provider response bodies in errors", async () => {
    const response = JSON.stringify({ error: { message: "provider diagnostic details" } });
    const fetch = vi.fn<AiFetchLike>().mockResolvedValue(new Response(response, { status: 400 }));

    await expect(new CustomAiClient(BASE_URL, MODEL, {}, "Ollama", fetch).ask(PROMPT)).rejects.toMatchObject({
      provider: "custom",
      kind: "request-failed",
      message: "Ollama request failed (400)",
    });
  });

  it("does not expose header values or the prompt in errors", async () => {
    const headers = { Authorization: "Bearer secret-token" };
    const response = JSON.stringify({ error: { message: `Bad Bearer secret-token: ${PROMPT}` } });
    const fetch = vi.fn<AiFetchLike>().mockResolvedValue(new Response(response, { status: 400 }));

    let errorMessage = "";
    try {
      await new CustomAiClient(BASE_URL, MODEL, headers, "Ollama", fetch).ask(PROMPT);
    } catch (error: unknown) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).not.toContain("secret-token");
    expect(errorMessage).not.toContain(PROMPT);
  });

  it("redacts a leaked token even when the error omits the Bearer prefix", async () => {
    const headers = { Authorization: "Bearer secret-token" };
    const response = JSON.stringify({ error: { message: "Rejected token secret-token" } });
    const fetch = vi.fn<AiFetchLike>().mockResolvedValue(new Response(response, { status: 400 }));

    let errorMessage = "";
    try {
      await new CustomAiClient(BASE_URL, MODEL, headers, "Ollama", fetch).ask(PROMPT);
    } catch (error: unknown) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).not.toContain("secret-token");
  });

  it("normalizes header whitespace before sending and redacting", async () => {
    const headers = { Authorization: "  Bearer secret-token  " };
    const response = JSON.stringify({ error: { message: "Rejected token secret-token" } });
    const fetch = vi.fn<AiFetchLike>().mockResolvedValue(new Response(response, { status: 400 }));

    let errorMessage = "";
    try {
      await new CustomAiClient(BASE_URL, MODEL, headers, "Ollama", fetch).ask(PROMPT);
    } catch (error: unknown) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer secret-token" });
    expect(errorMessage).not.toContain("secret-token");
  });

  it("normalizes network errors", async () => {
    const cause = new Error("socket failed");
    const fetch = vi.fn<AiFetchLike>().mockRejectedValue(cause);

    await expect(new CustomAiClient(BASE_URL, MODEL, {}, "Ollama", fetch).ask(PROMPT)).rejects.toMatchObject({
      provider: "custom",
      kind: "request-failed",
      message: "Could not connect to Ollama",
      cause,
    });
  });

  it("distinguishes user cancellation", async () => {
    const controller = new AbortController();
    const request = new CustomAiClient(BASE_URL, MODEL, {}, "Ollama", abortablePendingFetch(), 1_000).ask(
      PROMPT,
      controller.signal
    );
    controller.abort(new Error("cancelled by user"));

    await expect(request).rejects.toMatchObject({ provider: "custom", kind: "aborted" });
  });

  it("times out the request", async () => {
    const fetch = abortablePendingFetch();

    await expect(new CustomAiClient(BASE_URL, MODEL, {}, "Ollama", fetch, 5).ask(PROMPT)).rejects.toMatchObject({
      provider: "custom",
      kind: "timeout",
      message: "Ollama request timed out",
    });
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
