import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@raycast/api", () => ({
  Cache: class {
    get = vi.fn();
    remove = vi.fn();
    set = vi.fn();
  },
}));

import {
  MochiCatalogRepository,
  MochiCatalogRepositoryError,
  type MochiCatalogStorage,
} from "./mochi-catalog-repository";

class MemoryStorage implements MochiCatalogStorage {
  value: string | undefined;

  getItem(): string | undefined {
    return this.value;
  }

  setItem(_key: string, value: string): void {
    this.value = value;
  }

  removeItem(): void {
    this.value = undefined;
  }
}

describe("MochiCatalogRepository", () => {
  let storage: MemoryStorage;
  let repository: MochiCatalogRepository;

  beforeEach(() => {
    storage = new MemoryStorage();
    repository = new MochiCatalogRepository(storage);
  });

  it("stores decks and templates", () => {
    repository.replace({
      decks: [{ id: "deck-1", name: "Words" }],
      templates: [{ id: "template-1", name: "Vocabulary" }],
    });

    expect(repository.get()).toEqual({
      decks: [{ id: "deck-1", name: "Words" }],
      templates: [{ id: "template-1", name: "Vocabulary" }],
    });
  });

  it("returns undefined when the catalog was not cached", () => {
    expect(repository.get()).toBeUndefined();
  });

  it("clears the cached catalog", () => {
    repository.replace({ decks: [{ id: "deck-1", name: "Words" }], templates: [] });

    repository.clear();

    expect(repository.get()).toBeUndefined();
  });

  it("keeps corrupted storage unchanged", () => {
    storage.value = JSON.stringify({ version: 1, decks: "invalid", templates: [] });
    const original = storage.value;

    expect(() => repository.get()).toThrow(MochiCatalogRepositoryError);
    expect(storage.value).toBe(original);
  });
});
