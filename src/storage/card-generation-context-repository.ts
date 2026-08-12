import { LocalStorage } from "@raycast/api";

import type { FieldValue, FieldValues } from "../domain/template";

/** Single blob written by earlier versions; read-only now and migrated away on first access. */
export const LEGACY_STORAGE_KEY = "mochi-card-generation-contexts";
const KEY_PREFIX = "mochi-card-generation-context:v1:";
const STORAGE_VERSION = 1;
let mutationQueue: Promise<void> = Promise.resolve();

export type CardGenerationContext = {
  readonly cardId: string;
  readonly generationTemplateId: string;
  readonly generationTemplateUpdatedAt: string;
  readonly mochiTemplateId: string;
  readonly inputValues: FieldValues;
  readonly updatedAt: string;
};

export type OptionalCardGenerationContext = {
  readonly context?: CardGenerationContext;
  readonly warning?: string;
};

type CardGenerationContextEnvelope = {
  readonly version: typeof STORAGE_VERSION;
  readonly context: CardGenerationContext;
};

type LegacyEnvelope = {
  readonly version: typeof STORAGE_VERSION;
  readonly records: Readonly<Record<string, CardGenerationContext>>;
};

export interface CardGenerationContextStorage {
  getItem(key: string): Promise<string | undefined>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  allItems(): Promise<Readonly<Record<string, unknown>>>;
}

export class CardGenerationContextRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CardGenerationContextRepositoryError";
  }
}

/**
 * Stores one record per card ID. A shared blob would need a read-modify-write
 * cycle, which silently drops records when the background regeneration worker
 * and a foreground command save at the same time; separate keys let every
 * writer touch only its own card.
 */
export class CardGenerationContextRepository {
  private readonly storage: CardGenerationContextStorage;
  private readonly now: () => Date;
  private legacyMigration?: Promise<void>;

  constructor(storage: CardGenerationContextStorage = raycastStorage, now: () => Date = () => new Date()) {
    this.storage = storage;
    this.now = now;
  }

  async get(cardId: string): Promise<CardGenerationContext | undefined> {
    await mutationQueue;
    await this.migrateLegacyOnce();
    const storedValue = await this.storage.getItem(contextKey(cardId));
    return storedValue === undefined ? undefined : parseEnvelope(storedValue, cardId).context;
  }

  async getMany(cardIds: readonly string[]): Promise<Readonly<Record<string, CardGenerationContext>>> {
    await mutationQueue;
    await this.migrateLegacyOnce();
    const items = await this.storage.allItems();
    const result: Record<string, CardGenerationContext> = {};
    for (const cardId of cardIds) {
      const storedValue = items[contextKey(cardId)];
      if (typeof storedValue === "string") {
        result[cardId] = parseEnvelope(storedValue, cardId).context;
      }
    }
    return result;
  }

  async getOptional(cardId: string): Promise<OptionalCardGenerationContext> {
    try {
      return { context: await this.get(cardId) };
    } catch (error: unknown) {
      return {
        warning: `Saved generation inputs could not be read and were ignored. Stored data was left unchanged. ${errorMessage(error)}`,
      };
    }
  }

  async save(context: Omit<CardGenerationContext, "updatedAt">): Promise<CardGenerationContext> {
    return serializeMutation(async () => {
      await this.migrateLegacyOnce();
      const saved: CardGenerationContext = { ...context, updatedAt: this.now().toISOString() };
      if (!isCardGenerationContext(saved) || saved.cardId !== context.cardId) {
        throw new CardGenerationContextRepositoryError("Card generation context is invalid");
      }
      await this.write(saved);
      return saved;
    });
  }

  async delete(cardId: string): Promise<boolean> {
    return serializeMutation(async () => {
      await this.migrateLegacyOnce();
      if ((await this.storage.getItem(contextKey(cardId))) === undefined) {
        return false;
      }
      await this.storage.removeItem(contextKey(cardId));
      return true;
    });
  }

  /**
   * Moves the legacy blob into per-card keys. Idempotent, so concurrent processes
   * can each run it. The per-card check and write are not atomic across processes,
   * which is accepted: the blob only exists until the first access after an update.
   */
  private async migrateLegacyOnce(): Promise<void> {
    this.legacyMigration ??= this.migrateLegacy().catch((error: unknown) => {
      this.legacyMigration = undefined;
      throw error;
    });
    await this.legacyMigration;
  }

  private async migrateLegacy(): Promise<void> {
    const storedValue = await this.storage.getItem(LEGACY_STORAGE_KEY);
    if (storedValue === undefined) {
      return;
    }
    const records = parseLegacyEnvelope(storedValue).records;
    for (const context of Object.values(records)) {
      // Never overwrite a per-card key: it is newer than the blob by definition.
      if ((await this.storage.getItem(contextKey(context.cardId))) === undefined) {
        await this.write(context);
      }
    }
    await this.storage.removeItem(LEGACY_STORAGE_KEY);
  }

  private async write(context: CardGenerationContext): Promise<void> {
    await this.storage.setItem(
      contextKey(context.cardId),
      JSON.stringify({ version: STORAGE_VERSION, context } satisfies CardGenerationContextEnvelope)
    );
  }
}

function contextKey(cardId: string): string {
  return `${KEY_PREFIX}${cardId}`;
}

function parseEnvelope(storedValue: string, cardId: string): CardGenerationContextEnvelope {
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!isEnvelope(parsed) || parsed.context.cardId !== cardId) {
      throw new Error("Stored card generation context does not match a supported version");
    }
    return parsed;
  } catch (error: unknown) {
    throw new CardGenerationContextRepositoryError(
      "Saved card generation contexts are corrupted. The original data was left unchanged.",
      { cause: error }
    );
  }
}

function parseLegacyEnvelope(storedValue: string): LegacyEnvelope {
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!isLegacyEnvelope(parsed)) {
      throw new Error("Stored card generation contexts do not match a supported version");
    }
    return parsed;
  } catch (error: unknown) {
    throw new CardGenerationContextRepositoryError(
      "Saved card generation contexts are corrupted. The original data was left unchanged.",
      { cause: error }
    );
  }
}

function serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(mutation, mutation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

const raycastStorage: CardGenerationContextStorage = {
  async getItem(key: string): Promise<string | undefined> {
    return LocalStorage.getItem<string>(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await LocalStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await LocalStorage.removeItem(key);
  },
  async allItems(): Promise<Readonly<Record<string, unknown>>> {
    return LocalStorage.allItems();
  },
};

function isEnvelope(value: unknown): value is CardGenerationContextEnvelope {
  return isRecord(value) && value.version === STORAGE_VERSION && isCardGenerationContext(value.context);
}

function isLegacyEnvelope(value: unknown): value is LegacyEnvelope {
  if (!isRecord(value) || value.version !== STORAGE_VERSION || !isRecord(value.records)) {
    return false;
  }
  return Object.entries(value.records).every(
    ([cardId, context]) => isCardGenerationContext(context) && context.cardId === cardId
  );
}

function isCardGenerationContext(value: unknown): value is CardGenerationContext {
  return (
    isRecord(value) &&
    typeof value.cardId === "string" &&
    typeof value.generationTemplateId === "string" &&
    typeof value.generationTemplateUpdatedAt === "string" &&
    !Number.isNaN(Date.parse(value.generationTemplateUpdatedAt)) &&
    typeof value.mochiTemplateId === "string" &&
    isFieldValues(value.inputValues) &&
    typeof value.updatedAt === "string" &&
    !Number.isNaN(Date.parse(value.updatedAt))
  );
}

function isFieldValues(value: unknown): value is FieldValues {
  return isRecord(value) && Object.values(value).every(isFieldValue);
}

function isFieldValue(value: unknown): value is FieldValue {
  return typeof value === "string" || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
