import { AI_PROVIDER_DISPLAY_NAMES, AiProviderError, type AiProvider, type AiProviderErrorKind } from "./ai-provider";

export type AiFetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type HttpClientOptions = {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Record<string, string>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly fetch?: AiFetchLike;
  readonly sensitiveValues?: readonly string[];
  readonly displayName?: string;
  readonly redirect?: "error" | "follow" | "manual";
};

const DEFAULT_TIMEOUT_MS = 60_000;
const CUSTOM_RESPONSE_LIMIT_BYTES = 1024 * 1024;

export async function httpPost(provider: AiProvider, options: HttpClientOptions): Promise<unknown> {
  return httpJson(provider, options);
}

export async function httpGet(
  provider: AiProvider,
  options: Omit<HttpClientOptions, "body" | "method"> & { readonly method?: "GET" }
): Promise<unknown> {
  return httpJson(provider, { ...options, method: "GET" });
}

async function httpJson(provider: AiProvider, options: HttpClientOptions): Promise<unknown> {
  const {
    url,
    method,
    headers,
    body,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetch: fetchImplementation = globalThis.fetch,
    sensitiveValues = [],
    redirect,
  } = options;
  const displayName = options.displayName ?? AI_PROVIDER_DISPLAY_NAMES[provider];
  const requestController = new AbortController();
  let timedOut = false;
  const forwardAbort = (): void => requestController.abort(signal?.reason);
  if (signal?.aborted) {
    forwardAbort();
  } else {
    signal?.addEventListener("abort", forwardAbort, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    requestController.abort(new Error("AI provider request timed out"));
  }, timeoutMs);

  try {
    const response = await fetchImplementation(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: requestController.signal,
      ...(redirect ? { redirect } : {}),
    });
    const responseText =
      provider === "custom"
        ? await readLimitedResponseText(response, CUSTOM_RESPONSE_LIMIT_BYTES, displayName)
        : await response.text();
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("AI generation was cancelled");
    }
    if (!response.ok) {
      throw httpStatusError(provider, displayName, response.status, responseText, sensitiveValues);
    }
    return parseSuccessResponse(provider, displayName, responseText);
  } catch (error: unknown) {
    if (error instanceof AiProviderError) {
      throw error;
    }
    if (signal?.aborted) {
      throw new AiProviderError(provider, "aborted", "AI generation was cancelled", { cause: error });
    }
    if (timedOut) {
      throw new AiProviderError(provider, "timeout", `${displayName} request timed out`, {
        cause: error,
      });
    }
    throw new AiProviderError(provider, "request-failed", `Could not connect to ${displayName}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

async function readLimitedResponseText(response: Response, limitBytes: number, displayName: string): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return text + decoder.decode();
      }
      totalBytes += value.byteLength;
      if (totalBytes > limitBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AiProviderError("custom", "invalid-response", `${displayName} response exceeded the 1 MB limit`);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSuccessResponse(provider: AiProvider, displayName: string, responseText: string): unknown {
  try {
    return JSON.parse(responseText) as unknown;
  } catch (error: unknown) {
    throw new AiProviderError(provider, "invalid-response", `${displayName} returned malformed JSON`, {
      cause: error,
    });
  }
}

function statusToErrorKind(status: number): AiProviderErrorKind {
  if (status === 401 || status === 403) {
    return "authentication";
  }
  if (status === 429) {
    return "rate-limit";
  }
  if (status >= 500 && status < 600) {
    return "provider-unavailable";
  }
  return "request-failed";
}

function httpStatusError(
  provider: AiProvider,
  name: string,
  status: number,
  responseText: string,
  sensitiveValues: readonly string[]
): AiProviderError {
  const kind = statusToErrorKind(status);
  if (kind === "authentication") {
    return new AiProviderError(provider, kind, `${name} rejected the API key`, { status });
  }
  if (kind === "rate-limit") {
    return new AiProviderError(provider, kind, `${name} rate limit was reached`, { status });
  }
  if (kind === "provider-unavailable") {
    return new AiProviderError(provider, kind, `${name} is temporarily unavailable`, { status });
  }
  const providerMessage =
    provider !== "custom" && (status === 400 || status === 404) ? extractErrorMessage(responseText) : undefined;
  const safeMessage = providerMessage ? redactAndTruncate(providerMessage, sensitiveValues) : undefined;
  const message = safeMessage
    ? `${name} request failed (${status}): ${safeMessage}`
    : `${name} request failed (${status})`;
  return new AiProviderError(provider, kind, message.slice(0, 300), { status });
}

function extractErrorMessage(responseText: string): string | undefined {
  try {
    const data: unknown = JSON.parse(responseText);
    const message = extractMessageFromErrorResponse(data);
    if (message) {
      return message;
    }
  } catch {
    return responseText.trim() || undefined;
  }
  return undefined;
}

function extractMessageFromErrorResponse(data: unknown): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  if (typeof data.message === "string") {
    return data.message;
  }
  if (isRecord(data.error) && typeof data.error.message === "string") {
    return data.error.message;
  }
  if (Array.isArray(data.errors)) {
    for (const error of data.errors) {
      if (isRecord(error) && typeof error.message === "string") {
        return error.message;
      }
    }
  }
  return undefined;
}

function redactAndTruncate(message: string, sensitiveValues: readonly string[]): string {
  let safe = message;
  for (const value of sensitiveValues) {
    if (value.length > 0) {
      safe = safe.split(value).join("[redacted]");
    }
  }
  return safe.replace(/\s+/g, " ").trim().slice(0, 300);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
