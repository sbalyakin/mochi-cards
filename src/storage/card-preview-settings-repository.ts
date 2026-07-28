import { LocalStorage } from "@raycast/api";

const STORAGE_KEY = "mochi-card-preview-show-details";

export interface CardPreviewSettingsStorage {
  getItem(key: string): Promise<string | undefined>;
  setItem(key: string, value: string): Promise<void>;
}

export class CardPreviewSettingsRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CardPreviewSettingsRepositoryError";
  }
}

export class CardPreviewSettingsRepository {
  private readonly storage: CardPreviewSettingsStorage;

  constructor(storage: CardPreviewSettingsStorage = raycastCardPreviewSettingsStorage) {
    this.storage = storage;
  }

  async getShowMetadata(): Promise<boolean> {
    const storedValue = await this.storage.getItem(STORAGE_KEY);
    if (storedValue === undefined) {
      return false;
    }
    if (storedValue === "true") {
      return true;
    }
    if (storedValue === "false") {
      return false;
    }
    throw new CardPreviewSettingsRepositoryError(
      "Saved card preview settings are corrupted. The original data was left unchanged."
    );
  }

  async saveShowMetadata(showMetadata: boolean): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, String(showMetadata));
  }
}

const raycastCardPreviewSettingsStorage: CardPreviewSettingsStorage = {
  async getItem(key: string): Promise<string | undefined> {
    return LocalStorage.getItem<string>(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await LocalStorage.setItem(key, value);
  },
};
