import { describe, expect, it, vi } from "vitest";

vi.mock("@raycast/api", () => ({
  LocalStorage: {
    allItems: vi.fn(),
    getItem: vi.fn(),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

import { validateExtensionData } from "./extension-data-validation";

describe("extension data validation", () => {
  it("accepts an empty export", async () => {
    await expect(validateExtensionData({})).resolves.toBeUndefined();
  });

  it.each([
    ["templates", "mochi-card-templates", "{}"],
    ["deck selection", "mochi-visible-decks", "{}"],
    ["deck order", "mochi-deck-browse-order", "{}"],
    ["card sorting", "mochi-card-list-sort-preferences", "{}"],
    ["preview settings", "mochi-card-preview-show-details", "sometimes"],
    ["regeneration report", "mochi-regeneration-report-v1", "{}"],
    ["AI settings", "ai-provider-settings-v1", "{}"],
    [
      "generation context",
      "mochi-card-generation-context:v1:card-1",
      JSON.stringify({ version: 1, context: { cardId: "another-card" } }),
    ],
  ])("rejects invalid %s before import", async (_label, key, value) => {
    await expect(validateExtensionData({ [key]: value })).rejects.toThrow("extension data export is invalid");
  });

  it("allows unknown future string values", async () => {
    await expect(validateExtensionData({ "future-setting": "value" })).resolves.toBeUndefined();
  });
});
