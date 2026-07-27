import { LocalStorage } from "@raycast/api";

import { isCardSort, type CardSort } from "../card-sorting";

const STORAGE_KEY = "mochi-card-list-sort-preferences";
const STORAGE_VERSION = 1;

export type CardListSortPreference = {
  readonly sort: CardSort;
  readonly isReversed: boolean;
  readonly filter: CardListFilter;
  readonly showMetadata?: boolean;
};

export type CardListFilter = "all" | "reviewed" | "not-reviewed";

type CardListSortEnvelope = {
  readonly version: typeof STORAGE_VERSION;
  readonly preferences: Readonly<Record<string, CardListSortPreference>>;
};

export interface CardListSortStorage {
  getItem(key: string): Promise<string | undefined>;
  setItem(key: string, value: string): Promise<void>;
}

export class CardListSortRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CardListSortRepositoryError";
  }
}

export class CardListSortRepository {
  private readonly storage: CardListSortStorage;

  constructor(storage: CardListSortStorage = raycastCardListSortStorage) {
    this.storage = storage;
  }

  async get(deckId: string): Promise<CardListSortPreference | undefined> {
    const envelope = await this.readEnvelope();
    return envelope.preferences[deckId];
  }

  async save(deckId: string, preference: CardListSortPreference): Promise<void> {
    if (!deckId || !isPreference(preference)) {
      throw new CardListSortRepositoryError("Card list sort preference is invalid");
    }
    const envelope = await this.readEnvelope();
    await this.storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...envelope,
        preferences: { ...envelope.preferences, [deckId]: preference },
      } satisfies CardListSortEnvelope)
    );
  }

  private async readEnvelope(): Promise<CardListSortEnvelope> {
    const storedValue = await this.storage.getItem(STORAGE_KEY);
    if (storedValue === undefined) {
      return { version: STORAGE_VERSION, preferences: {} };
    }
    try {
      const parsed: unknown = JSON.parse(storedValue);
      if (!isEnvelope(parsed)) {
        throw new Error("Stored card list sort preferences do not match a supported version");
      }
      return parsed;
    } catch (error: unknown) {
      throw new CardListSortRepositoryError(
        "Saved card list sort preferences are corrupted. The original data was left unchanged.",
        { cause: error }
      );
    }
  }
}

const raycastCardListSortStorage: CardListSortStorage = {
  async getItem(key: string): Promise<string | undefined> {
    return LocalStorage.getItem<string>(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await LocalStorage.setItem(key, value);
  },
};

function isEnvelope(value: unknown): value is CardListSortEnvelope {
  return (
    isRecord(value) &&
    value.version === STORAGE_VERSION &&
    isRecord(value.preferences) &&
    Object.values(value.preferences).every(isPreference)
  );
}

function isPreference(value: unknown): value is CardListSortPreference {
  return (
    isRecord(value) &&
    typeof value.sort === "string" &&
    isCardSort(value.sort) &&
    typeof value.isReversed === "boolean" &&
    isCardListFilter(value.filter) &&
    (value.showMetadata === undefined || typeof value.showMetadata === "boolean")
  );
}

export function isCardListFilter(value: unknown): value is CardListFilter {
  return value === "all" || value === "reviewed" || value === "not-reviewed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
