import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

import {
  CardListSortRepository,
  CardListSortRepositoryError,
  type CardListSortStorage,
} from "./card-list-sort-repository";

class MemoryStorage implements CardListSortStorage {
  value: string | undefined;

  async getItem(): Promise<string | undefined> {
    return this.value;
  }

  async setItem(_key: string, value: string): Promise<void> {
    this.value = value;
  }
}

describe("CardListSortRepository", () => {
  let storage: MemoryStorage;
  let repository: CardListSortRepository;

  beforeEach(() => {
    storage = new MemoryStorage();
    repository = new CardListSortRepository(storage);
  });

  it("stores sort preferences independently for each deck", async () => {
    await repository.save("deck-1", { sort: "updated-at", isReversed: true, filter: "reviewed", showMetadata: false });
    await repository.save("deck-2", { sort: "alphabetical", isReversed: false, filter: "all", showMetadata: true });

    await expect(repository.get("deck-1")).resolves.toEqual({
      sort: "updated-at",
      isReversed: true,
      filter: "reviewed",
      showMetadata: false,
    });
    await expect(repository.get("deck-2")).resolves.toEqual({
      sort: "alphabetical",
      isReversed: false,
      filter: "all",
      showMetadata: true,
    });
  });

  it("returns no preference when a deck has not been configured", async () => {
    await expect(repository.get("deck-1")).resolves.toBeUndefined();
  });

  it("reads preferences saved before detail visibility was tracked", async () => {
    storage.value = JSON.stringify({
      version: 1,
      preferences: { "deck-1": { sort: "position", isReversed: false, filter: "all" } },
    });

    await expect(repository.get("deck-1")).resolves.toEqual({ sort: "position", isReversed: false, filter: "all" });
  });

  it("keeps corrupted storage unchanged", async () => {
    storage.value = "{broken";
    const original = storage.value;

    await expect(repository.get("deck-1")).rejects.toBeInstanceOf(CardListSortRepositoryError);
    expect(storage.value).toBe(original);
  });
});
