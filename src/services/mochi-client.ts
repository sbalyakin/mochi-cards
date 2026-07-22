import { normalizeDeckId, type CardTemplate } from "../domain/template";

const MOCHI_CARDS_URL = "https://app.mochi.cards/api/cards/";
const DEFAULT_TIMEOUT_MS = 15_000;

export type MochiErrorKind = "network" | "unauthorized" | "validation" | "http" | "aborted";

export class MochiError extends Error {
  readonly kind: MochiErrorKind;
  readonly status?: number;

  constructor(kind: MochiErrorKind, message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "MochiError";
    this.kind = kind;
    this.status = status;
  }
}

export type CreatedMochiCard = {
  readonly id?: string;
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class MochiClient {
  private readonly apiKey: string;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(apiKey: string, fetchImplementation: FetchLike = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.apiKey = apiKey;
    this.fetch = fetchImplementation;
    this.timeoutMs = timeoutMs;
  }

  async createCard(content: string, template: CardTemplate, signal?: AbortSignal): Promise<CreatedMochiCard> {
    const requestController = new AbortController();
    const forwardAbort = (): void => requestController.abort(signal?.reason);
    if (signal?.aborted) {
      forwardAbort();
    } else {
      signal?.addEventListener("abort", forwardAbort, { once: true });
    }
    const timeout = setTimeout(
      () => requestController.abort(new MochiError("network", "Mochi request timed out")),
      this.timeoutMs
    );

    try {
      const response = await this.fetch(MOCHI_CARDS_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
          "deck-id": normalizeDeckId(template.deckId),
          "template-id": null,
          "manual-tags": template.tags,
          "review-reverse?": template.reviewReverse,
          "archived?": template.archived,
        }),
        signal: requestController.signal,
      });

      const responseText = await response.text();
      if (!response.ok) {
        const message = responseErrorMessage(responseText, response.status);
        if (response.status === 401 || response.status === 403) {
          throw new MochiError("unauthorized", "Mochi rejected the API key", response.status);
        }
        if (response.status === 400 || response.status === 422) {
          throw new MochiError("validation", message, response.status);
        }
        throw new MochiError("http", message, response.status);
      }

      return parseCreatedCard(responseText);
    } catch (error: unknown) {
      if (error instanceof MochiError) {
        throw error;
      }
      if (signal?.aborted) {
        throw new MochiError("aborted", "Mochi request was cancelled", undefined, { cause: error });
      }
      if (requestController.signal.reason instanceof MochiError) {
        throw requestController.signal.reason;
      }
      throw new MochiError("network", errorMessage(error, "Could not connect to Mochi"), undefined, { cause: error });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }
}

function parseCreatedCard(responseText: string): CreatedMochiCard {
  if (responseText.trim().length === 0) {
    return {};
  }

  try {
    const value: unknown = JSON.parse(responseText);
    if (isRecord(value) && typeof value.id === "string") {
      return { id: value.id };
    }
  } catch {
    return {};
  }
  return {};
}

function responseErrorMessage(responseText: string, status: number): string {
  if (responseText.trim().length === 0) {
    return `Mochi returned HTTP ${status}`;
  }

  try {
    const value: unknown = JSON.parse(responseText);
    if (isRecord(value)) {
      for (const key of ["message", "error", "detail"]) {
        if (typeof value[key] === "string" && value[key].length > 0) {
          return value[key];
        }
      }
    }
  } catch {
    return `Mochi returned HTTP ${status}`;
  }
  return `Mochi returned HTTP ${status}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
