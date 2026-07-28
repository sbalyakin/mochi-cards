import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@raycast/api", () => ({
  LocalStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

import {
  CardPreviewSettingsRepository,
  CardPreviewSettingsRepositoryError,
  type CardPreviewSettingsStorage,
} from "./card-preview-settings-repository";

class MemoryStorage implements CardPreviewSettingsStorage {
  value: string | undefined;

  async getItem(): Promise<string | undefined> {
    return this.value;
  }

  async setItem(_key: string, value: string): Promise<void> {
    this.value = value;
  }
}

describe("CardPreviewSettingsRepository", () => {
  let storage: MemoryStorage;
  let repository: CardPreviewSettingsRepository;

  beforeEach(() => {
    storage = new MemoryStorage();
    repository = new CardPreviewSettingsRepository(storage);
  });

  it("hides details by default and saves the selected visibility", async () => {
    await expect(repository.getShowMetadata()).resolves.toBe(false);

    await repository.saveShowMetadata(true);

    await expect(repository.getShowMetadata()).resolves.toBe(true);
  });

  it("leaves corrupted settings unchanged", async () => {
    storage.value = "unexpected";
    const original = storage.value;

    await expect(repository.getShowMetadata()).rejects.toBeInstanceOf(CardPreviewSettingsRepositoryError);
    expect(storage.value).toBe(original);
  });
});
