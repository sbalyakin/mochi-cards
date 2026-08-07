import { AiProviderError } from "./ai-provider";

/**
 * Removes surrounding whitespace and a trailing slash so the base URL can be
 * concatenated with a path (e.g. `/chat/completions`) without a double slash.
 */
export function normalizeCustomBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Validates a custom provider base URL and returns its normalized form.
 * Only plain `http`/`https` URLs without embedded credentials, a query
 * string, or a fragment are accepted.
 */
export function validateCustomBaseUrl(value: string, displayName: string): string {
  const normalized = normalizeCustomBaseUrl(value);
  if (!normalized) {
    throw configurationError(`${displayName} Base URL is required`);
  }
  if (normalized.endsWith("?")) {
    throw configurationError(`${displayName} Base URL must not include a query string`);
  }
  if (normalized.endsWith("#")) {
    throw configurationError(`${displayName} Base URL must not include a fragment`);
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch (error: unknown) {
    throw configurationError(`${displayName} Base URL is invalid`, error);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw configurationError(`${displayName} Base URL must use http or https`);
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw configurationError(`${displayName} Base URL must use https for non-loopback hosts`);
  }
  if (url.username || url.password) {
    throw configurationError(`${displayName} Base URL must not include credentials`);
  }
  if (url.search) {
    throw configurationError(`${displayName} Base URL must not include a query string`);
  }
  if (url.hash) {
    throw configurationError(`${displayName} Base URL must not include a fragment`);
  }
  return normalized;
}

/**
 * Detects a base URL that sends plaintext HTTP to a non-local host, which
 * exposes headers (including credentials) to the network.
 */
export function isRemoteHttpBaseUrl(value: string): boolean {
  try {
    const url = new URL(normalizeCustomBaseUrl(value));
    return url.protocol === "http:" && !isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Parses the custom headers JSON preference into a header map. Empty input
 * is treated as no extra headers. Only a flat object of string values is
 * accepted.
 */
export function parseCustomHeaders(json: string | undefined, displayName: string): Record<string, string> {
  const trimmed = (json ?? "").trim();
  if (!trimmed) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error: unknown) {
    throw configurationError(`${displayName} Headers JSON is invalid`, error);
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw configurationError(`${displayName} Headers JSON must be an object`);
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw configurationError(`${displayName} header "${key}" must be a string value`);
    }
    headers[key] = value;
  }
  return normalizeCustomHeaders(headers, displayName);
}

export function normalizeCustomHeaders(
  headers: Readonly<Record<string, string>>,
  displayName: string
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    try {
      const validated = new Headers({ [key]: value });
      normalized[key] = validated.get(key) ?? "";
    } catch (error: unknown) {
      throw configurationError(`${displayName} header "${key}" is invalid`, error);
    }
  }
  return normalized;
}

export function withBearerAuthorization(
  headers: Readonly<Record<string, string>>,
  apiKey: string | undefined,
  displayName: string
): Record<string, string> {
  const normalizedApiKey = apiKey?.trim();
  if (!normalizedApiKey) {
    return { ...headers };
  }
  const authorizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLocaleLowerCase() !== "authorization") {
      authorizedHeaders[key] = value;
    }
  }
  authorizedHeaders.Authorization = `Bearer ${normalizedApiKey}`;
  return normalizeCustomHeaders(authorizedHeaders, displayName);
}

/**
 * Expands header values into the full set of substrings that must be
 * redacted from error messages. In addition to the full header value, this
 * includes the credential portion after a scheme prefix (e.g. the token in
 * `Bearer sk-...`) so a leaked token is redacted even when a provider echoes
 * it back without the scheme.
 */
export function sensitiveHeaderValues(headers: Readonly<Record<string, string>>): readonly string[] {
  const values: string[] = [];
  for (const rawValue of Object.values(headers)) {
    const value = rawValue.trim();
    values.push(value);
    const credential = /^\S+\s+(.+)$/.exec(value)?.[1];
    if (credential) {
      values.push(credential);
    }
  }
  return values;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isIpv4Loopback(hostname) ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isIpv4Loopback(hostname: string): boolean {
  const octets = hostname.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
  );
}

function configurationError(message: string, cause?: unknown): AiProviderError {
  return new AiProviderError("custom", "configuration", message, cause ? { cause } : undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
