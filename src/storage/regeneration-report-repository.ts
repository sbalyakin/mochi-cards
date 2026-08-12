import { LocalStorage } from "@raycast/api";

import type { BulkCardOperationStatus } from "../services/bulk-card-regenerator";

const STORAGE_KEY = "mochi-regeneration-report-v1";
const STORAGE_VERSION = 1;

const OPERATION_STATUSES: readonly BulkCardOperationStatus[] = [
  "pending",
  "running",
  "updated",
  "updated-with-warning",
  "failed",
  "skipped",
  "cancelled",
];

export type RegenerationCardOutcome = {
  readonly cardId: string;
  readonly title: string;
  readonly status: BulkCardOperationStatus;
  readonly message?: string;
};

export type RegenerationReport = {
  readonly templateId: string;
  readonly templateName: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly updates: readonly RegenerationCardOutcome[];
};

type RegenerationReportEnvelope = {
  readonly version: typeof STORAGE_VERSION;
  readonly report: RegenerationReport;
};

export interface RegenerationReportStorage {
  getItem(key: string): Promise<string | undefined>;
  setItem(key: string, value: string): Promise<void>;
}

export class RegenerationReportRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RegenerationReportRepositoryError";
  }
}

export class RegenerationReportRepository {
  private readonly storage: RegenerationReportStorage;

  constructor(storage: RegenerationReportStorage = raycastStorage) {
    this.storage = storage;
  }

  async save(report: RegenerationReport): Promise<void> {
    await this.storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, report } satisfies RegenerationReportEnvelope)
    );
  }

  async get(): Promise<RegenerationReport | undefined> {
    const storedValue = await this.storage.getItem(STORAGE_KEY);
    if (storedValue === undefined) {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(storedValue);
      if (!isEnvelope(parsed)) {
        throw new Error("Stored regeneration report does not match a supported version");
      }
      return parsed.report;
    } catch (error: unknown) {
      throw new RegenerationReportRepositoryError("Saved regeneration report is corrupted and could not be read.", {
        cause: error,
      });
    }
  }
}

const raycastStorage: RegenerationReportStorage = {
  async getItem(key: string): Promise<string | undefined> {
    return LocalStorage.getItem<string>(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await LocalStorage.setItem(key, value);
  },
};

function isEnvelope(value: unknown): value is RegenerationReportEnvelope {
  return isRecord(value) && value.version === STORAGE_VERSION && isRegenerationReport(value.report);
}

function isRegenerationReport(value: unknown): value is RegenerationReport {
  return (
    isRecord(value) &&
    typeof value.templateId === "string" &&
    typeof value.templateName === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.finishedAt === "string" &&
    Array.isArray(value.updates) &&
    value.updates.every(isRegenerationCardOutcome)
  );
}

function isRegenerationCardOutcome(value: unknown): value is RegenerationCardOutcome {
  return (
    isRecord(value) &&
    typeof value.cardId === "string" &&
    typeof value.title === "string" &&
    typeof value.status === "string" &&
    OPERATION_STATUSES.includes(value.status as BulkCardOperationStatus) &&
    (value.message === undefined || typeof value.message === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
