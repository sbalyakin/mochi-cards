import { LocalStorage } from "@raycast/api";

const STORAGE_KEY = "mochi-deck-browse-order";
const STORAGE_VERSION = 1;

type DeckBrowseOrderEnvelope = {
  readonly version: typeof STORAGE_VERSION;
  readonly deckIds: readonly string[];
};

export interface DeckBrowseOrderStorage {
  getItem(key: string): Promise<string | undefined>;
  setItem(key: string, value: string): Promise<void>;
}

export class DeckBrowseOrderRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DeckBrowseOrderRepositoryError";
  }
}

export class DeckBrowseOrderRepository {
  private readonly storage: DeckBrowseOrderStorage;

  constructor(storage: DeckBrowseOrderStorage = raycastDeckBrowseOrderStorage) {
    this.storage = storage;
  }

  async list(): Promise<readonly string[]> {
    const storedValue = await this.storage.getItem(STORAGE_KEY);
    if (storedValue === undefined) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(storedValue);
      if (!isEnvelope(parsed)) {
        throw new Error("Stored deck browse order does not match a supported version");
      }
      return normalizeDeckIds(parsed.deckIds);
    } catch (error: unknown) {
      throw new DeckBrowseOrderRepositoryError(
        "Saved deck browse order is corrupted. The original data was left unchanged.",
        { cause: error }
      );
    }
  }

  async replace(deckIds: readonly string[]): Promise<void> {
    await this.storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, deckIds: normalizeDeckIds(deckIds) } satisfies DeckBrowseOrderEnvelope)
    );
  }
}

const raycastDeckBrowseOrderStorage: DeckBrowseOrderStorage = {
  async getItem(key: string): Promise<string | undefined> {
    return LocalStorage.getItem<string>(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await LocalStorage.setItem(key, value);
  },
};

function isEnvelope(value: unknown): value is DeckBrowseOrderEnvelope {
  return (
    isRecord(value) &&
    value.version === STORAGE_VERSION &&
    Array.isArray(value.deckIds) &&
    value.deckIds.every((deckId) => typeof deckId === "string")
  );
}

function normalizeDeckIds(deckIds: readonly string[]): readonly string[] {
  return [...new Set(deckIds.map((deckId) => deckId.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
