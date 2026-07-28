import { describe, expect, it, vi } from "vitest";

vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

import {
  CardGenerationContextRepository,
  CardGenerationContextRepositoryError,
  type CardGenerationContextStorage,
} from "./card-generation-context-repository";

class MemoryStorage implements CardGenerationContextStorage {
  value: string | undefined;
  reads = 0;
  writes = 0;

  async getItem(): Promise<string | undefined> {
    this.reads += 1;
    return this.value;
  }

  async setItem(_key: string, value: string): Promise<void> {
    this.value = value;
    this.writes += 1;
  }
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
    storage.value = "not-json";
    const repository = new CardGenerationContextRepository(storage);

    await expect(repository.getMany(["card"])).rejects.toBeInstanceOf(CardGenerationContextRepositoryError);
    expect(storage.value).toBe("not-json");
    expect(storage.writes).toBe(0);
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
    storage.value = stored;
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
    expect(storage.value).toBe(stored);
    expect(storage.writes).toBe(0);
  });

  it("loads corrupt optional context fail-open without changing stored data", async () => {
    const storage = new MemoryStorage();
    storage.value = "not-json";
    const repository = new CardGenerationContextRepository(storage);

    await expect(repository.getOptional("card")).resolves.toEqual({
      warning:
        "Saved generation inputs could not be read and were ignored. Stored data was left unchanged. Saved card generation contexts are corrupted. The original data was left unchanged.",
    });
    expect(storage.value).toBe("not-json");
    expect(storage.writes).toBe(0);
  });
});
