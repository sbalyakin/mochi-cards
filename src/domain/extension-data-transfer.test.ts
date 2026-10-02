import { describe, expect, it } from "vitest";

import {
  parseExtensionData,
  replaceExtensionData,
  serializeExtensionData,
  type ExtensionDataStorage,
  type ExtensionDataValue,
} from "./extension-data-transfer";

class MemoryStorage implements ExtensionDataStorage {
  readonly items = new Map<string, ExtensionDataValue>();
  failOnceForKey?: string;

  async allItems(): Promise<Readonly<Record<string, unknown>>> {
    return Object.fromEntries(this.items);
  }

  async clear(): Promise<void> {
    this.items.clear();
  }

  async setItem(key: string, value: ExtensionDataValue): Promise<void> {
    if (key === this.failOnceForKey) {
      this.failOnceForKey = undefined;
      throw new Error("write failed");
    }
    this.items.set(key, value);
  }
}

describe("extension data transfer", () => {
  it("round-trips supported local storage values", () => {
    const exported = serializeExtensionData(
      { templates: "json", count: 2, enabled: true },
      new Date("2026-09-16T12:00:00.000Z")
    );

    expect(JSON.parse(exported)).toMatchObject({
      format: "mochi-cards-extension-data",
      version: 1,
      exportedAt: "2026-09-16T12:00:00.000Z",
    });
    expect(parseExtensionData(exported)).toEqual({ templates: "json", count: 2, enabled: true });
  });

  it.each([
    ["invalid JSON", "not-json"],
    ["another JSON document", JSON.stringify({ localStorage: {} })],
    [
      "an unsupported local storage value",
      JSON.stringify({ format: "mochi-cards-extension-data", version: 1, localStorage: { templates: null } }),
    ],
  ])("rejects %s", (_label, content) => {
    expect(() => parseExtensionData(content)).toThrow();
  });

  it("describes parse failures as file errors", () => {
    expect(() => parseExtensionData("not-json")).toThrow("selected file");
  });

  it("replaces all existing local storage values", async () => {
    const storage = new MemoryStorage();
    storage.items.set("old", "value");

    await replaceExtensionData(storage, { templates: "json", enabled: true });

    expect(Object.fromEntries(storage.items)).toEqual({ templates: "json", enabled: true });
  });

  it("restores existing values when an import write fails", async () => {
    const storage = new MemoryStorage();
    storage.items.set("old", "value");
    storage.failOnceForKey = "broken";

    await expect(replaceExtensionData(storage, { templates: "json", broken: true })).rejects.toThrow("write failed");
    expect(Object.fromEntries(storage.items)).toEqual({ old: "value" });
  });
});
