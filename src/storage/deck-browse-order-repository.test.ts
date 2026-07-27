import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

import {
  DeckBrowseOrderRepository,
  DeckBrowseOrderRepositoryError,
  type DeckBrowseOrderStorage,
} from "./deck-browse-order-repository";

class MemoryStorage implements DeckBrowseOrderStorage {
  value: string | undefined;

  async getItem(): Promise<string | undefined> {
    return this.value;
  }

  async setItem(_key: string, value: string): Promise<void> {
    this.value = value;
  }
}

describe("DeckBrowseOrderRepository", () => {
  let storage: MemoryStorage;
  let repository: DeckBrowseOrderRepository;

  beforeEach(() => {
    storage = new MemoryStorage();
    repository = new DeckBrowseOrderRepository(storage);
  });

  it("stores a normalized deck order", async () => {
    await repository.replace([" deck-2 ", "deck-1", "deck-2", ""]);

    await expect(repository.list()).resolves.toEqual(["deck-2", "deck-1"]);
  });

  it("keeps corrupted storage unchanged", async () => {
    storage.value = "{broken";
    const original = storage.value;

    await expect(repository.list()).rejects.toBeInstanceOf(DeckBrowseOrderRepositoryError);
    expect(storage.value).toBe(original);
  });
});
