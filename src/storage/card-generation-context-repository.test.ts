import { describe, expect, it, vi } from "vitest";

vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    allItems: vi.fn(),
  },
}));

import {
  CardGenerationContextRepository,
  CardGenerationContextRepositoryError,
  LEGACY_STORAGE_KEY,
  type CardGenerationContextStorage,
} from "./card-generation-context-repository";

class MemoryStorage implements CardGenerationContextStorage {
  items = new Map<string, string>();
  reads = 0;
  writes = 0;

  async getItem(key: string): Promise<string | undefined> {
    this.reads += 1;
    return this.items.get(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    this.items.set(key, value);
    this.writes += 1;
  }

  async removeItem(key: string): Promise<void> {
    this.items.delete(key);
  }

  async allItems(): Promise<Readonly<Record<string, unknown>>> {
    this.reads += 1;
    return Object.fromEntries(this.items);
  }
}

function legacyBlob(records: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ version: 1, records });
}

function legacyRecord(cardId: string, word: string): Record<string, unknown> {
  return {
    cardId,
    generationTemplateId: "generation-1",
    generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
    mochiTemplateId: "mochi-1",
    inputValues: { word },
    updatedAt: "2026-07-24T11:00:00.000Z",
  };
}

describe("CardGenerationContextRepository", () => {
  it("round-trips and deletes records by card ID", async () => {
    const storage = new MemoryStorage();
    const repository = new CardGenerationContextRepository(storage, () => new Date("2026-07-24T12:00:00.000Z"));

    await repository.save({
      cardId: "card-1",
      generationTemplateId: "generation-1",
      generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
      mochiTemplateId: "mochi-1",
      inputValues: { word: "λόγος", active: true },
    });

    await expect(repository.get("card-1")).resolves.toEqual({
      cardId: "card-1",
      generationTemplateId: "generation-1",
      generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
      mochiTemplateId: "mochi-1",
      inputValues: { word: "λόγος", active: true },
      updatedAt: "2026-07-24T12:00:00.000Z",
    });
    await expect(repository.delete("card-1")).resolves.toBe(true);
    await expect(repository.get("card-1")).resolves.toBeUndefined();
  });

  it("serializes mutations across repository instances", async () => {
    const storage = new MemoryStorage();
    const first = new CardGenerationContextRepository(storage, () => new Date("2026-07-24T12:00:00.000Z"));
    const second = new CardGenerationContextRepository(storage, () => new Date("2026-07-24T12:00:01.000Z"));

    await Promise.all([
      first.save({
        cardId: "card-1",
        generationTemplateId: "generation-1",
        generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
        mochiTemplateId: "mochi-1",
        inputValues: { word: "one" },
      }),
      second.save({
        cardId: "card-2",
        generationTemplateId: "generation-2",
        generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
        mochiTemplateId: "mochi-2",
        inputValues: { word: "two" },
      }),
    ]);

    await expect(first.get("card-1")).resolves.toMatchObject({ inputValues: { word: "one" } });
    await expect(first.get("card-2")).resolves.toMatchObject({ inputValues: { word: "two" } });
  });

  it("waits for queued mutations before reading", async () => {
    const storage = new MemoryStorage();
    const repository = new CardGenerationContextRepository(storage, () => new Date("2026-07-24T12:00:00.000Z"));

    const save = repository.save({
      cardId: "card-1",
      generationTemplateId: "generation-1",
      generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
      mochiTemplateId: "mochi-1",
      inputValues: { word: "queued" },
    });

    await expect(repository.get("card-1")).resolves.toMatchObject({ inputValues: { word: "queued" } });
    await save;
  });

  it("getMany reads storage once and returns only requested records", async () => {
    const storage = new MemoryStorage();
    const repository = new CardGenerationContextRepository(storage, () => new Date("2026-07-24T12:00:00.000Z"));
    const firstSave = repository.save({
      cardId: "card-1",
      generationTemplateId: "generation-1",
      generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
      mochiTemplateId: "mochi-1",
      inputValues: { word: "one" },
    });
    const secondSave = repository.save({
      cardId: "card-2",
      generationTemplateId: "generation-2",
      generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
      mochiTemplateId: "mochi-2",
      inputValues: { word: "two" },
    });
    await Promise.all([firstSave, secondSave]);
    const readsBefore = storage.reads;

    await expect(repository.getMany(["card-2", "missing"])).resolves.toEqual({
      "card-2": expect.objectContaining({ inputValues: { word: "two" } }),
    });
    expect(storage.reads - readsBefore).toBe(1);
  });

  it("getMany waits for queued mutations", async () => {
    const storage = new MemoryStorage();
    const repository = new CardGenerationContextRepository(storage, () => new Date("2026-07-24T12:00:00.000Z"));
    const save = repository.save({
      cardId: "card-1",
      generationTemplateId: "generation-1",
      generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
      mochiTemplateId: "mochi-1",
      inputValues: { word: "queued" },
    });

    await expect(repository.getMany(["card-1"])).resolves.toEqual({
      "card-1": expect.objectContaining({ inputValues: { word: "queued" } }),
    });
    await save;
  });

  it("getMany reports corrupted storage without writing", async () => {
    const storage = new MemoryStorage();
    storage.items.set(LEGACY_STORAGE_KEY, "not-json");
    const repository = new CardGenerationContextRepository(storage);

    await expect(repository.getMany(["card"])).rejects.toBeInstanceOf(CardGenerationContextRepositoryError);
    expect(storage.items.get(LEGACY_STORAGE_KEY)).toBe("not-json");
    expect(storage.writes).toBe(0);
  });

  it("keeps records of different cards in separate keys", async () => {
    const storage = new MemoryStorage();
    const repository = new CardGenerationContextRepository(storage, () => new Date("2026-07-24T12:00:00.000Z"));

    await repository.save({
      cardId: "card-1",
      generationTemplateId: "generation-1",
      generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
      mochiTemplateId: "mochi-1",
      inputValues: { word: "one" },
    });
    await repository.save({
      cardId: "card-2",
      generationTemplateId: "generation-2",
      generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
      mochiTemplateId: "mochi-2",
      inputValues: { word: "two" },
    });

    expect(storage.items.size).toBe(2);
    // A writer that only knows about card-1 cannot touch the key holding card-2.
    const keys = [...storage.items.keys()];
    expect(keys.filter((key) => key.endsWith("card-1"))).toHaveLength(1);
    expect(keys.filter((key) => key.endsWith("card-2"))).toHaveLength(1);
  });

  it("does not lose a record written by another process while saving", async () => {
    const storage = new MemoryStorage();
    const repository = new CardGenerationContextRepository(storage, () => new Date("2026-07-24T12:00:00.000Z"));
    const other = new CardGenerationContextRepository(storage, () => new Date("2026-07-24T12:00:01.000Z"));
    await repository.save({
      cardId: "card-1",
      generationTemplateId: "generation-1",
      generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
      mochiTemplateId: "mochi-1",
      inputValues: { word: "one" },
    });

    // Simulates a foreground command that read nothing and writes its own card.
    await other.save({
      cardId: "card-2",
      generationTemplateId: "generation-2",
      generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
      mochiTemplateId: "mochi-2",
      inputValues: { word: "two" },
    });

    await expect(repository.getMany(["card-1", "card-2"])).resolves.toEqual({
      "card-1": expect.objectContaining({ inputValues: { word: "one" } }),
      "card-2": expect.objectContaining({ inputValues: { word: "two" } }),
    });
  });

  it("migrates the legacy blob into per-card keys and removes it", async () => {
    const storage = new MemoryStorage();
    storage.items.set(
      LEGACY_STORAGE_KEY,
      legacyBlob({ "card-1": legacyRecord("card-1", "one"), "card-2": legacyRecord("card-2", "two") })
    );
    const repository = new CardGenerationContextRepository(storage);

    await expect(repository.get("card-1")).resolves.toMatchObject({ inputValues: { word: "one" } });
    await expect(repository.getMany(["card-2"])).resolves.toEqual({
      "card-2": expect.objectContaining({ inputValues: { word: "two" } }),
    });
    expect(storage.items.has(LEGACY_STORAGE_KEY)).toBe(false);
    expect(storage.items.size).toBe(2);
  });

  it("migration never overwrites a per-card record that already exists", async () => {
    const storage = new MemoryStorage();
    const repository = new CardGenerationContextRepository(storage, () => new Date("2026-07-24T12:00:00.000Z"));
    await repository.save({
      cardId: "card-1",
      generationTemplateId: "generation-1",
      generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
      mochiTemplateId: "mochi-1",
      inputValues: { word: "newer" },
    });
    storage.items.set(LEGACY_STORAGE_KEY, legacyBlob({ "card-1": legacyRecord("card-1", "older") }));

    const migrated = new CardGenerationContextRepository(storage);

    await expect(migrated.get("card-1")).resolves.toMatchObject({ inputValues: { word: "newer" } });
  });

  it.each([
    "not-json",
    JSON.stringify({ version: 2, records: {} }),
    JSON.stringify({
      version: 1,
      records: {
        card: {
          cardId: "card",
          generationTemplateId: "generation",
          generationTemplateUpdatedAt: "invalid",
          mochiTemplateId: "mochi",
          inputValues: {},
          updatedAt: "2026-07-24T00:00:00.000Z",
        },
      },
    }),
  ])("reports corrupt or stale data without overwriting it", async (stored) => {
    const storage = new MemoryStorage();
    storage.items.set(LEGACY_STORAGE_KEY, stored);
    const repository = new CardGenerationContextRepository(storage);

    await expect(repository.get("card")).rejects.toBeInstanceOf(CardGenerationContextRepositoryError);
    await expect(
      repository.save({
        cardId: "card",
        generationTemplateId: "generation",
        generationTemplateUpdatedAt: "2026-07-24T00:00:00.000Z",
        mochiTemplateId: "mochi",
        inputValues: {},
      })
    ).rejects.toBeInstanceOf(CardGenerationContextRepositoryError);
    expect(storage.items.get(LEGACY_STORAGE_KEY)).toBe(stored);
    expect(storage.writes).toBe(0);
  });

  it("reports a corrupt per-card record without overwriting it", async () => {
    const storage = new MemoryStorage();
    const repository = new CardGenerationContextRepository(storage, () => new Date("2026-07-24T12:00:00.000Z"));
    await repository.save({
      cardId: "card-1",
      generationTemplateId: "generation-1",
      generationTemplateUpdatedAt: "2026-07-24T10:00:00.000Z",
      mochiTemplateId: "mochi-1",
      inputValues: { word: "one" },
    });
    const [key] = [...storage.items.keys()];
    storage.items.set(key, "not-json");

    await expect(repository.get("card-1")).rejects.toBeInstanceOf(CardGenerationContextRepositoryError);
    await expect(repository.getMany(["card-1"])).rejects.toBeInstanceOf(CardGenerationContextRepositoryError);
    expect(storage.items.get(key)).toBe("not-json");
  });

  it("loads corrupt optional context fail-open without changing stored data", async () => {
    const storage = new MemoryStorage();
    storage.items.set(LEGACY_STORAGE_KEY, "not-json");
    const repository = new CardGenerationContextRepository(storage);

    await expect(repository.getOptional("card")).resolves.toEqual({
      warning:
        "Saved generation inputs could not be read and were ignored. Stored data was left unchanged. Saved card generation contexts are corrupted. The original data was left unchanged.",
    });
    expect(storage.items.get(LEGACY_STORAGE_KEY)).toBe("not-json");
    expect(storage.writes).toBe(0);
  });
});
