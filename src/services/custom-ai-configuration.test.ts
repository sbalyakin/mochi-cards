import { describe, expect, it } from "vitest";

import {
  isRemoteHttpBaseUrl,
  normalizeCustomBaseUrl,
  parseCustomHeaders,
  sensitiveHeaderValues,
  validateCustomBaseUrl,
  withBearerAuthorization,
} from "./custom-ai-configuration";

describe("normalizeCustomBaseUrl", () => {
  it("trims whitespace and a trailing slash", () => {
    expect(normalizeCustomBaseUrl("  http://localhost:11434/v1/  ")).toBe("http://localhost:11434/v1");
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeCustomBaseUrl("http://localhost:11434/v1///")).toBe("http://localhost:11434/v1");
  });
});

describe("validateCustomBaseUrl", () => {
  it("accepts an https URL", () => {
    expect(validateCustomBaseUrl("https://openrouter.ai/api/v1", "OpenRouter")).toBe("https://openrouter.ai/api/v1");
  });

  it("accepts a local http URL", () => {
    expect(validateCustomBaseUrl("http://localhost:11434/v1", "Ollama")).toBe("http://localhost:11434/v1");
    expect(validateCustomBaseUrl("http://127.0.0.2:11434/v1", "Ollama")).toBe("http://127.0.0.2:11434/v1");
  });

  it("rejects a non-loopback http URL", () => {
    expect(() => validateCustomBaseUrl("http://example.com/v1", "OpenRouter")).toThrowError(
      expect.objectContaining({ message: "OpenRouter Base URL must use https for non-loopback hosts" })
    );
  });

  it.each(["http://127.0.0.1.evil.com/v1", "http://127.example.com/v1", "http://127.0.0.1example.com/v1"])(
    "rejects deceptive loopback hostname %s",
    (baseUrl) => {
      expect(() => validateCustomBaseUrl(baseUrl, "Custom AI")).toThrowError(
        expect.objectContaining({ message: "Custom AI Base URL must use https for non-loopback hosts" })
      );
      expect(isRemoteHttpBaseUrl(baseUrl)).toBe(true);
    }
  );

  it("rejects an empty Base URL", () => {
    expect(() => validateCustomBaseUrl("  ", "Ollama")).toThrowError(
      expect.objectContaining({ provider: "custom", kind: "configuration", message: "Ollama Base URL is required" })
    );
  });

  it("rejects a malformed Base URL", () => {
    expect(() => validateCustomBaseUrl("not a url", "Ollama")).toThrowError(
      expect.objectContaining({ provider: "custom", kind: "configuration", message: "Ollama Base URL is invalid" })
    );
  });

  it.each(["ftp://example.com", "ws://example.com"])("rejects a non-http(s) scheme %s", (baseUrl) => {
    expect(() => validateCustomBaseUrl(baseUrl, "Ollama")).toThrowError(
      expect.objectContaining({ message: "Ollama Base URL must use http or https" })
    );
  });

  it("rejects embedded credentials", () => {
    expect(() => validateCustomBaseUrl("https://user:pass@example.com/v1", "Ollama")).toThrowError(
      expect.objectContaining({ message: "Ollama Base URL must not include credentials" })
    );
  });

  it("rejects a query string", () => {
    expect(() => validateCustomBaseUrl("https://example.com/v1?key=1", "Ollama")).toThrowError(
      expect.objectContaining({ message: "Ollama Base URL must not include a query string" })
    );
  });

  it("rejects a bare query delimiter", () => {
    expect(() => validateCustomBaseUrl("https://example.com/v1?", "Ollama")).toThrowError(
      expect.objectContaining({ message: "Ollama Base URL must not include a query string" })
    );
  });

  it("rejects a fragment", () => {
    expect(() => validateCustomBaseUrl("https://example.com/v1#section", "Ollama")).toThrowError(
      expect.objectContaining({ message: "Ollama Base URL must not include a fragment" })
    );
  });

  it("rejects a bare fragment delimiter", () => {
    expect(() => validateCustomBaseUrl("https://example.com/v1#", "Ollama")).toThrowError(
      expect.objectContaining({ message: "Ollama Base URL must not include a fragment" })
    );
  });
});

describe("isRemoteHttpBaseUrl", () => {
  it("is false for a local http URL", () => {
    expect(isRemoteHttpBaseUrl("http://localhost:11434/v1")).toBe(false);
    expect(isRemoteHttpBaseUrl("http://127.0.0.1:1234/v1")).toBe(false);
  });

  it("is true for a remote http URL", () => {
    expect(isRemoteHttpBaseUrl("http://example.com/v1")).toBe(true);
  });

  it("is false for a remote https URL", () => {
    expect(isRemoteHttpBaseUrl("https://example.com/v1")).toBe(false);
  });

  it("is false for a malformed URL", () => {
    expect(isRemoteHttpBaseUrl("not a url")).toBe(false);
  });
});

describe("parseCustomHeaders", () => {
  it("returns no headers for empty input", () => {
    expect(parseCustomHeaders(undefined, "Ollama")).toEqual({});
    expect(parseCustomHeaders("  ", "Ollama")).toEqual({});
  });

  it("parses a flat object of string values", () => {
    expect(parseCustomHeaders('{"Authorization": "Bearer sk-1", "X-Api": "v1"}', "OpenRouter")).toEqual({
      Authorization: "Bearer sk-1",
      "X-Api": "v1",
    });
  });

  it("normalizes surrounding whitespace in header values", () => {
    expect(parseCustomHeaders('{"Authorization": "  Bearer sk-1  "}', "OpenRouter")).toEqual({
      Authorization: "Bearer sk-1",
    });
  });

  it("rejects invalid JSON", () => {
    expect(() => parseCustomHeaders("not json", "Ollama")).toThrowError(
      expect.objectContaining({ provider: "custom", kind: "configuration", message: "Ollama Headers JSON is invalid" })
    );
  });

  it("rejects a non-object JSON value", () => {
    expect(() => parseCustomHeaders("[1,2,3]", "Ollama")).toThrowError(
      expect.objectContaining({ message: "Ollama Headers JSON must be an object" })
    );
  });

  it("rejects a non-string header value", () => {
    expect(() => parseCustomHeaders('{"X-Api": 1}', "Ollama")).toThrowError(
      expect.objectContaining({ message: 'Ollama header "X-Api" must be a string value' })
    );
  });

  it("rejects an invalid header name", () => {
    expect(() => parseCustomHeaders('{"bad header": "v"}', "Ollama")).toThrowError(
      expect.objectContaining({
        provider: "custom",
        kind: "configuration",
        message: 'Ollama header "bad header" is invalid',
      })
    );
  });

  it("rejects a header value with an embedded newline", () => {
    expect(() => parseCustomHeaders('{"X-Api": "line1\\nline2"}', "Ollama")).toThrowError(
      expect.objectContaining({ message: 'Ollama header "X-Api" is invalid' })
    );
  });
});

describe("withBearerAuthorization", () => {
  it("adds a trimmed Bearer API key and replaces an additional Authorization header", () => {
    expect(
      withBearerAuthorization({ authorization: "Basic old", "X-Organization": "team" }, "  secret-key  ", "OpenRouter")
    ).toEqual({ Authorization: "Bearer secret-key", "X-Organization": "team" });
  });

  it("preserves additional headers when the API key is empty", () => {
    expect(withBearerAuthorization({ Authorization: "Bearer existing" }, "  ", "OpenRouter")).toEqual({
      Authorization: "Bearer existing",
    });
  });
});

describe("sensitiveHeaderValues", () => {
  it("includes the full header value", () => {
    expect(sensitiveHeaderValues({ "X-Api-Key": "raw-token" })).toEqual(["raw-token"]);
  });

  it("also includes the credential after a scheme prefix", () => {
    expect(sensitiveHeaderValues({ Authorization: "Bearer sk-1" })).toEqual(["Bearer sk-1", "sk-1"]);
  });

  it("normalizes whitespace before deriving sensitive values", () => {
    expect(sensitiveHeaderValues({ Authorization: "  Bearer sk-1  " })).toEqual(["Bearer sk-1", "sk-1"]);
  });
});
