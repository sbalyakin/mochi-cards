import { AiSettingsRepository } from "./services/ai-settings-repository";
import { CardGenerationContextRepository } from "./storage/card-generation-context-repository";
import { CardListSortRepository } from "./storage/card-list-sort-repository";
import { CardPreviewSettingsRepository } from "./storage/card-preview-settings-repository";
import { DeckBrowseOrderRepository } from "./storage/deck-browse-order-repository";
import { DeckSelectionRepository } from "./storage/deck-selection-repository";
import { RegenerationReportRepository } from "./storage/regeneration-report-repository";
import { TemplateRepository } from "./storage/template-repository";
import type { ExtensionData, ExtensionDataValue } from "./extension-data-transfer";

const CONTEXT_KEY_PREFIX = "mochi-card-generation-context:v1:";

export async function validateExtensionData(items: ExtensionData): Promise<void> {
  const storage = new ValidationStorage(items);
  try {
    await new TemplateRepository(storage).list();
    await new DeckSelectionRepository(storage).list();
    await new DeckBrowseOrderRepository(storage).list();
    await new CardListSortRepository(storage).get("");
    await new CardPreviewSettingsRepository(storage).getShowMetadata();
    await new RegenerationReportRepository(storage).get();
    await new AiSettingsRepository(storage, noSecrets).get();

    const contextIds = Object.keys(items)
      .filter((key) => key.startsWith(CONTEXT_KEY_PREFIX))
      .map((key) => key.slice(CONTEXT_KEY_PREFIX.length));
    const contexts = new CardGenerationContextRepository(storage);
    await contexts.getMany(contextIds);
    for (const contextId of contextIds) {
      await contexts.get(contextId);
    }
  } catch (error: unknown) {
    throw new Error(`The extension data export is invalid: ${errorMessage(error)}`, { cause: error });
  }
}

class ValidationStorage {
  private readonly items: Map<string, ExtensionDataValue>;

  constructor(items: ExtensionData) {
    this.items = new Map(Object.entries(items));
  }

  async getItem(key: string): Promise<string | undefined> {
    const value = this.items.get(key);
    if (value === undefined || typeof value === "string") {
      return value;
    }
    throw new Error(`Stored value "${key}" must be a string`);
  }

  async setItem(key: string, value: string): Promise<void> {
    this.items.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.items.delete(key);
  }

  async allItems(): Promise<Readonly<Record<string, unknown>>> {
    return Object.fromEntries(this.items);
  }
}

const noSecrets = {
  async getSecret(): Promise<undefined> {
    return undefined;
  },
  async setSecret(): Promise<void> {},
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
