import { normalizeDeckId, type CardTemplate } from "../domain/template";

const MOCHI_CARDS_URL = "https://app.mochi.cards/api/cards/";
const MOCHI_DECKS_URL = "https://app.mochi.cards/api/decks";
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

export type MochiDeck = {
  readonly id: string;
  readonly name: string;
};

type MochiDeckPage = {
  readonly decks: readonly MochiDeck[];
  readonly bookmark?: string;
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
    const responseText = await this.request(
      MOCHI_CARDS_URL,
      {
        method: "POST",
        headers: {
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
      },
      signal
    );

    return parseCreatedCard(responseText);
  }

  async listDecks(signal?: AbortSignal): Promise<readonly MochiDeck[]> {
    const decks = new Map<string, MochiDeck>();
    const bookmarks = new Set<string>();
    let bookmark: string | undefined;

    do {
      const url = bookmark ? `${MOCHI_DECKS_URL}?bookmark=${encodeURIComponent(bookmark)}` : MOCHI_DECKS_URL;
      const page = parseDeckPage(await this.request(url, { method: "GET" }, signal));
      page.decks.forEach((deck) => decks.set(deck.id, deck));
      if (page.bookmark && bookmarks.has(page.bookmark)) {
        break;
      }
      bookmark = page.bookmark;
      if (bookmark) {
        bookmarks.add(bookmark);
      }
    } while (bookmark);

    return [...decks.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  private async request(url: string, init: RequestInit, signal?: AbortSignal): Promise<string> {
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
      const response = await this.fetch(url, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`,
        },
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

      return responseText;
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

function parseDeckPage(responseText: string): MochiDeckPage {
  try {
    const value: unknown = JSON.parse(responseText);
    if (
      !isRecord(value) ||
      !Array.isArray(value.docs) ||
      (value.bookmark !== undefined && typeof value.bookmark !== "string")
    ) {
      throw new Error("Mochi returned an invalid deck list");
    }
    return { decks: value.docs.filter(isMochiDeck), bookmark: value.bookmark };
  } catch (error: unknown) {
    if (error instanceof MochiError) {
      throw error;
    }
    throw new MochiError("http", errorMessage(error, "Mochi returned an invalid deck list"), undefined, {
      cause: error,
    });
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

function isMochiDeck(value: unknown): value is MochiDeck {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}
