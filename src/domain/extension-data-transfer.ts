const EXPORT_FORMAT = "mochi-cards-extension-data";
const EXPORT_VERSION = 1;

export type ExtensionDataValue = string | number | boolean;
export type ExtensionData = Readonly<Record<string, ExtensionDataValue>>;

export interface ExtensionDataStorage {
  allItems(): Promise<Readonly<Record<string, unknown>>>;
  clear(): Promise<void>;
  setItem(key: string, value: ExtensionDataValue): Promise<void>;
}

type ExtensionDataEnvelope = {
  readonly format: typeof EXPORT_FORMAT;
  readonly version: typeof EXPORT_VERSION;
  readonly exportedAt: string;
  readonly localStorage: ExtensionData;
};

export function serializeExtensionData(items: Readonly<Record<string, unknown>>, now: Date = new Date()): string {
  const envelope: ExtensionDataEnvelope = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    localStorage: parseItems(items),
  };
  return JSON.stringify(envelope, null, 2);
}

export function parseExtensionData(content: string): ExtensionData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    throw new Error("The selected file does not contain valid JSON", { cause: error });
  }

  if (!isRecord(parsed) || parsed.format !== EXPORT_FORMAT || parsed.version !== EXPORT_VERSION) {
    throw new Error("The selected file does not contain a Mochi Cards data export");
  }
  return parseItems(parsed.localStorage);
}

export async function replaceExtensionData(storage: ExtensionDataStorage, items: ExtensionData): Promise<void> {
  const previousItems = parseItems(await storage.allItems());
  try {
    await writeItems(storage, items);
  } catch (error: unknown) {
    try {
      await writeItems(storage, previousItems);
    } catch (restoreError: unknown) {
      throw new Error("Import failed and the previous extension data could not be restored", {
        cause: restoreError,
      });
    }
    throw error;
  }
}

function parseItems(value: unknown): ExtensionData {
  if (!isRecord(value)) {
    throw new Error("The extension data export has invalid local storage");
  }

  const items: [string, ExtensionDataValue][] = [];
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" && typeof item !== "boolean" && (typeof item !== "number" || !Number.isFinite(item))) {
      throw new Error(`The extension data export has an invalid value for "${key}"`);
    }
    items.push([key, item]);
  }
  return Object.fromEntries(items);
}

async function writeItems(storage: ExtensionDataStorage, items: ExtensionData): Promise<void> {
  await storage.clear();
  for (const [key, value] of Object.entries(items)) {
    await storage.setItem(key, value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
