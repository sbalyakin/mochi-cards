import { environment } from "@raycast/api";
import fs from "fs";
import path from "path";

const LOCK_FILE_NAME = "regeneration-lock.json";
const STALE_AFTER_MS = 30 * 60 * 1000;

export interface RegenerationLockFileSystem {
  /** Atomically creates the file with its complete content, failing (returns false) if it already exists. */
  createExclusive(filePath: string, content: string): boolean;
  read(filePath: string): string | undefined;
  write(filePath: string, content: string): void;
  remove(filePath: string): void;
}

type LockRecord = {
  readonly token: string;
  readonly acquiredAt: string;
};

type LockState =
  { readonly kind: "missing" } | { readonly kind: "invalid" } | { readonly kind: "held"; readonly record: LockRecord };

export class RegenerationLockRepository {
  private readonly fileSystem: RegenerationLockFileSystem;
  private readonly filePath: string;

  constructor(
    fileSystem: RegenerationLockFileSystem = nodeFileSystem,
    filePath: string = path.join(environment.supportPath, LOCK_FILE_NAME)
  ) {
    this.fileSystem = fileSystem;
    this.filePath = filePath;
  }

  /**
   * Mutual exclusion rests on a single atomic primitive: an exclusive create that
   * only one caller can win. Taking over an abandoned lock, refreshing it and
   * releasing it are plain read-then-write sequences guarded by the lease token,
   * which covers the conflict that actually happens here — a second regeneration
   * started by hand while one is already running.
   */
  async acquire(): Promise<string | undefined> {
    const token = createToken();
    if (this.tryCreate(token)) {
      return token;
    }

    const state = this.readState();
    if (state.kind === "held" && !isStale(state.record)) {
      return undefined;
    }
    // Vanished, corrupted or abandoned: free the path and claim it.
    this.fileSystem.remove(this.filePath);
    return this.tryCreate(token) ? token : undefined;
  }

  /**
   * Returns whether `token` still owns the lease; a `false` result means the
   * caller must stop mutating and back off. A lock held by somebody else is left
   * exactly as it is.
   */
  async heartbeat(token: string): Promise<boolean> {
    const state = this.readState();
    if (state.kind !== "held" || state.record.token !== token) {
      return false;
    }
    this.fileSystem.write(this.filePath, lockRecord(token));
    return true;
  }

  /** Frees the lock, unless the lock file already belongs to somebody else. */
  async release(token: string): Promise<void> {
    const state = this.readState();
    if (state.kind === "held" && state.record.token === token) {
      this.fileSystem.remove(this.filePath);
    }
  }

  private tryCreate(token: string): boolean {
    return this.fileSystem.createExclusive(this.filePath, lockRecord(token));
  }

  private readState(): LockState {
    const stored = this.fileSystem.read(this.filePath);
    return stored === undefined ? { kind: "missing" } : parseState(stored);
  }
}

function lockRecord(token: string): string {
  return JSON.stringify({ token, acquiredAt: new Date().toISOString() } satisfies LockRecord);
}

function parseState(content: string): Exclude<LockState, { readonly kind: "missing" }> {
  try {
    const parsed: unknown = JSON.parse(content);
    return isLockRecord(parsed) ? { kind: "held", record: parsed } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

function isStale(record: LockRecord): boolean {
  const acquiredAtMs = new Date(record.acquiredAt).getTime();
  return !Number.isFinite(acquiredAtMs) || Date.now() - acquiredAtMs >= STALE_AFTER_MS;
}

function isLockRecord(value: unknown): value is LockRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).token === "string" &&
    typeof (value as Record<string, unknown>).acquiredAt === "string"
  );
}

function createToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const nodeFileSystem: RegenerationLockFileSystem = {
  createExclusive(filePath, content) {
    try {
      fs.writeFileSync(filePath, content, { flag: "wx" });
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      throw error;
    }
  },
  read(filePath) {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  },
  write(filePath, content) {
    fs.writeFileSync(filePath, content);
  },
  remove(filePath) {
    try {
      fs.unlinkSync(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Already gone; nothing to clean up.
        return;
      }
      throw error;
    }
  },
};
