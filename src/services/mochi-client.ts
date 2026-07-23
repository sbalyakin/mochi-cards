import { normalizeDeckId, type CardTemplate } from "../domain/template";

const MOCHI_CARDS_URL = "https://app.mochi.cards/api/cards/";
const MOCHI_DECKS_URL = "https://app.mochi.cards/api/decks";
const MOCHI_TEMPLATES_URL = "https://app.mochi.cards/api/templates/";
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

export function isMochiDeckNotFoundError(error: unknown): boolean {
  if (!(error instanceof MochiError)) {
    return false;
  }
  if (error.status === 404) {
    return true;
  }
  if (error.kind !== "validation") {
    return false;
  }
  return /(?:deck(?:-id)?.*(?:invalid|not found|does not exist|unknown|missing)|no .*deck)/i.test(error.message);
}

export type CreatedMochiCard = {
  readonly id?: string;
};

export type MochiDeck = {
  readonly id: string;
  readonly name: string;
};

export type MochiCardField = {
  readonly id: string;
  readonly value: string;
};

export type MochiCard = {
  readonly id: string;
  readonly deckId: string;
  readonly content: string;
  readonly name: string | null;
  readonly tags: readonly string[];
  readonly fields: readonly MochiCardField[];
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly archived?: boolean;
  readonly templateId?: string | null;
};

export type MochiTemplate = {
  readonly id: string;
  readonly name: string;
};

type MochiCardPage = {
  readonly cards: readonly MochiCard[];
  readonly bookmark?: string;
};

type MochiDeckPage = {
  readonly decks: readonly MochiDeck[];
  readonly bookmark?: string;
};

type MochiTemplatePage = {
  readonly templates: readonly MochiTemplate[];
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
          "template-id": template.mochiTemplateId,
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

  async listCards(deckId: string, signal?: AbortSignal): Promise<readonly MochiCard[]> {
    const cards = new Map<string, MochiCard>();
    const bookmarks = new Set<string>();
    let bookmark: string | undefined;

    do {
      const parameters = new URLSearchParams({
        "deck-id": normalizeDeckId(deckId),
        limit: "100",
      });
      if (bookmark) {
        parameters.set("bookmark", bookmark);
      }
      const page = parseCardPage(
        await this.request(`${MOCHI_CARDS_URL}?${parameters.toString()}`, { method: "GET" }, signal)
      );
      page.cards.forEach((card) => cards.set(card.id, card));
      if (page.bookmark && bookmarks.has(page.bookmark)) {
        break;
      }
      bookmark = page.bookmark;
      if (bookmark) {
        bookmarks.add(bookmark);
      }
    } while (bookmark);

    return [...cards.values()];
  }

  async listTemplates(signal?: AbortSignal): Promise<readonly MochiTemplate[]> {
    const templates = new Map<string, MochiTemplate>();
    const bookmarks = new Set<string>();
    let bookmark: string | undefined;

    do {
      const url = bookmark ? `${MOCHI_TEMPLATES_URL}?bookmark=${encodeURIComponent(bookmark)}` : MOCHI_TEMPLATES_URL;
      const page = parseTemplatePage(await this.request(url, { method: "GET" }, signal));
      page.templates.forEach((template) => templates.set(template.id, template));
      if (page.bookmark && bookmarks.has(page.bookmark)) {
        break;
      }
      bookmark = page.bookmark;
      if (bookmark) {
        bookmarks.add(bookmark);
      }
    } while (bookmark);

    return [...templates.values()].sort((left, right) => left.name.localeCompare(right.name));
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

function parseCardPage(responseText: string): MochiCardPage {
  try {
    const value: unknown = JSON.parse(responseText);
    if (
      !isRecord(value) ||
      !Array.isArray(value.docs) ||
      (value.bookmark !== undefined && typeof value.bookmark !== "string")
    ) {
      throw new Error("Mochi returned an invalid card list");
    }
    return {
      cards: value.docs.flatMap((card) => {
        const parsed = parseMochiCard(card);
        return parsed ? [parsed] : [];
      }),
      bookmark: value.bookmark,
    };
  } catch (error: unknown) {
    if (error instanceof MochiError) {
      throw error;
    }
    throw new MochiError("http", errorMessage(error, "Mochi returned an invalid card list"), undefined, {
      cause: error,
    });
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

function parseTemplatePage(responseText: string): MochiTemplatePage {
  try {
    const value: unknown = JSON.parse(responseText);
    if (
      !isRecord(value) ||
      !Array.isArray(value.docs) ||
      (value.bookmark !== undefined && typeof value.bookmark !== "string")
    ) {
      throw new Error("Mochi returned an invalid template list");
    }
    return { templates: value.docs.filter(isMochiTemplate), bookmark: value.bookmark };
  } catch (error: unknown) {
    if (error instanceof MochiError) {
      throw error;
    }
    throw new MochiError("http", errorMessage(error, "Mochi returned an invalid template list"), undefined, {
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
      const structuredErrors = structuredErrorMessage(value.errors);
      if (structuredErrors) {
        return structuredErrors;
      }
    }
  } catch {
    return `Mochi returned HTTP ${status}`;
  }
  return `Mochi returned HTTP ${status}`;
}

function structuredErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (Array.isArray(value)) {
    const messages = value.filter((message): message is string => typeof message === "string" && message.length > 0);
    return messages.length > 0 ? messages.join(", ") : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const messages = Object.entries(value).flatMap(([field, message]) =>
    typeof message === "string" && message.length > 0 ? [`${field}: ${message}`] : []
  );
  return messages.length > 0 ? messages.join(", ") : undefined;
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

function parseMochiCard(value: unknown): MochiCard | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value["deck-id"] !== "string" ||
    typeof value.content !== "string"
  ) {
    return undefined;
  }

  const name = typeof value.name === "string" ? value.name : null;
  const tags = Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const archived = typeof value["archived?"] === "boolean" ? value["archived?"] : undefined;
  const templateId =
    typeof value["template-id"] === "string" || value["template-id"] === null ? value["template-id"] : undefined;

  return {
    id: value.id,
    deckId: normalizeDeckId(value["deck-id"]),
    content: value.content,
    name,
    tags,
    fields: parseCardFields(value.fields),
    createdAt: parseMochiDate(value["created-at"]),
    updatedAt: parseMochiDate(value["updated-at"]),
    archived,
    templateId,
  };
}

function parseCardFields(value: unknown): readonly MochiCardField[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.values(value).flatMap((field) => {
    if (!isRecord(field) || typeof field.id !== "string" || typeof field.value !== "string") {
      return [];
    }
    return [{ id: field.id, value: field.value }];
  });
}

function parseMochiDate(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.date !== "string" || Number.isNaN(Date.parse(value.date))) {
    return undefined;
  }
  return value.date;
}

function isMochiTemplate(value: unknown): value is MochiTemplate {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}
