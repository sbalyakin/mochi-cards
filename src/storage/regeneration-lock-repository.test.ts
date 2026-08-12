import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@raycast/api", () => ({
  environment: { supportPath: "/tmp/mochi-cards-test" },
}));

import { RegenerationLockRepository, type RegenerationLockFileSystem } from "./regeneration-lock-repository";

class FakeFileSystem implements RegenerationLockFileSystem {
  private files = new Map<string, string>();

  /** Test-only setup shortcut for a lock file that some other process left behind. */
  put(filePath: string, content: string): void {
    this.files.set(filePath, content);
  }

  createExclusive(filePath: string, content: string): boolean {
    if (this.files.has(filePath)) {
      return false;
    }
    this.files.set(filePath, content);
    return true;
  }

  read(filePath: string): string | undefined {
    return this.files.get(filePath);
  }

  write(filePath: string, content: string): void {
    this.files.set(filePath, content);
  }

  remove(filePath: string): void {
    this.files.delete(filePath);
  }

  paths(): readonly string[] {
    return [...this.files.keys()];
  }
}

const LOCK_PATH = "/tmp/mochi-cards-test/regeneration-lock.json";

function staleRecord(token = "old"): string {
  return JSON.stringify({ token, acquiredAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() });
}

function freshRecord(token: string): string {
  return JSON.stringify({ token, acquiredAt: new Date().toISOString() });
}

describe("RegenerationLockRepository", () => {
  it("acquires lock when none is held and returns a lease token", async () => {
    const fileSystem = new FakeFileSystem();
    const repository = new RegenerationLockRepository(fileSystem, LOCK_PATH);

    const token = await repository.acquire();
    expect(token).toBeDefined();
    expect(fileSystem.read(LOCK_PATH)).toContain(token);
  });

  it("refuses to acquire a fresh lock already held", async () => {
    const fileSystem = new FakeFileSystem();
    const repository = new RegenerationLockRepository(fileSystem, LOCK_PATH);
    await repository.acquire();

    expect(await repository.acquire()).toBeUndefined();
  });

  it("allows acquiring again after release", async () => {
    const fileSystem = new FakeFileSystem();
    const repository = new RegenerationLockRepository(fileSystem, LOCK_PATH);
    const token = await repository.acquire();
    await repository.release(token as string);

    expect(fileSystem.paths()).toEqual([]);
    expect(await repository.acquire()).toBeDefined();
  });

  it("takes over a stale lock", async () => {
    const fileSystem = new FakeFileSystem();
    fileSystem.put(LOCK_PATH, staleRecord());
    const repository = new RegenerationLockRepository(fileSystem, LOCK_PATH);

    const token = await repository.acquire();

    expect(token).toBeDefined();
    expect(fileSystem.read(LOCK_PATH)).toContain(token);
    expect(fileSystem.paths()).toEqual([LOCK_PATH]);
  });

  it("clears a corrupted lock file instead of blocking forever", async () => {
    const fileSystem = new FakeFileSystem();
    fileSystem.put(LOCK_PATH, "not json at all");
    const repository = new RegenerationLockRepository(fileSystem, LOCK_PATH);

    const token = await repository.acquire();
    expect(token).toBeDefined();
    expect(fileSystem.read(LOCK_PATH)).toContain(token);
  });

  it("clears a lock file whose JSON does not match the record shape", async () => {
    const fileSystem = new FakeFileSystem();
    fileSystem.put(LOCK_PATH, JSON.stringify({ unexpected: true }));
    const repository = new RegenerationLockRepository(fileSystem, LOCK_PATH);

    expect(await repository.acquire()).toBeDefined();
  });

  it("does not release a lock owned by a different token", async () => {
    const fileSystem = new FakeFileSystem();
    const repository = new RegenerationLockRepository(fileSystem, LOCK_PATH);
    await repository.acquire();
    const held = fileSystem.read(LOCK_PATH);

    await repository.release("someone-elses-token");

    expect(fileSystem.read(LOCK_PATH)).toBe(held);
    expect(await repository.acquire()).toBeUndefined();
  });

  it("heartbeat refreshes acquiredAt and reports ownership for the owning token", async () => {
    const fileSystem = new FakeFileSystem();
    const repository = new RegenerationLockRepository(fileSystem, LOCK_PATH);
    const token = await repository.acquire();
    const initial = fileSystem.read(LOCK_PATH);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const stillOwns = await repository.heartbeat(token as string);

    expect(stillOwns).toBe(true);
    expect(fileSystem.read(LOCK_PATH)).not.toBe(initial);
  });

  it("heartbeat reports lost ownership without touching a lock it does not own", async () => {
    const fileSystem = new FakeFileSystem();
    const repository = new RegenerationLockRepository(fileSystem, LOCK_PATH);
    await repository.acquire();
    const initial = fileSystem.read(LOCK_PATH);

    const stillOwns = await repository.heartbeat("someone-elses-token");

    expect(stillOwns).toBe(false);
    expect(fileSystem.read(LOCK_PATH)).toBe(initial);
  });

  it("heartbeat reports lost ownership once the lock is released", async () => {
    const fileSystem = new FakeFileSystem();
    const repository = new RegenerationLockRepository(fileSystem, LOCK_PATH);
    const token = (await repository.acquire()) as string;
    await repository.release(token);

    expect(await repository.heartbeat(token)).toBe(false);
  });

  it("heartbeat reports lost ownership when another lease replaced ours", async () => {
    const fileSystem = new FakeFileSystem();
    const repository = new RegenerationLockRepository(fileSystem, LOCK_PATH);
    const token = (await repository.acquire()) as string;
    fileSystem.put(LOCK_PATH, freshRecord("newcomer"));

    expect(await repository.heartbeat(token)).toBe(false);
    expect(fileSystem.read(LOCK_PATH)).toContain("newcomer");
  });
});

describe("RegenerationLockRepository on the real file system", () => {
  const directories: string[] = [];

  function lockPath(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-lock-"));
    directories.push(directory);
    return path.join(directory, "regeneration-lock.json");
  }

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("grants the lock to exactly one of two repositories and leaves no staging file", async () => {
    const filePath = lockPath();
    const first = new RegenerationLockRepository(undefined, filePath);
    const second = new RegenerationLockRepository(undefined, filePath);

    const tokens = await Promise.all([first.acquire(), second.acquire()]);

    const token = tokens.find((candidate) => candidate !== undefined);
    expect(tokens.filter((candidate) => candidate !== undefined)).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toMatchObject({ token });
    expect(fs.readdirSync(path.dirname(filePath))).toEqual([path.basename(filePath)]);
  });

  it("takes over a stale lock", async () => {
    const filePath = lockPath();
    fs.writeFileSync(filePath, staleRecord());
    const repository = new RegenerationLockRepository(undefined, filePath);

    const token = await repository.acquire();

    expect(token).toBeDefined();
    expect(fs.readFileSync(filePath, "utf8")).toContain(token);
    expect(fs.readdirSync(path.dirname(filePath))).toEqual([path.basename(filePath)]);
  });

  it("recovers from a corrupted lock file", async () => {
    const filePath = lockPath();
    fs.writeFileSync(filePath, "{ truncated");
    const repository = new RegenerationLockRepository(undefined, filePath);

    expect(await repository.acquire()).toBeDefined();
  });

  it("propagates unreadable lock files instead of treating them as free", async () => {
    const filePath = lockPath();
    fs.writeFileSync(filePath, staleRecord());
    fs.chmodSync(filePath, 0o000);
    const repository = new RegenerationLockRepository(undefined, filePath);

    await expect(repository.acquire()).rejects.toThrow();

    fs.chmodSync(filePath, 0o600);
  });

  it("keeps heartbeat and release scoped to the owning token", async () => {
    const filePath = lockPath();
    const repository = new RegenerationLockRepository(undefined, filePath);
    const token = (await repository.acquire()) as string;

    expect(await repository.heartbeat("other")).toBe(false);
    await repository.release("other");
    expect(await repository.heartbeat(token)).toBe(true);

    await repository.release(token);

    expect(await repository.heartbeat(token)).toBe(false);
    expect(await repository.acquire()).toBeDefined();
    expect(fs.readdirSync(path.dirname(filePath))).toEqual([path.basename(filePath)]);
  });

  it("release leaves a lock that replaced ours in place", async () => {
    const filePath = lockPath();
    const repository = new RegenerationLockRepository(undefined, filePath);
    const token = (await repository.acquire()) as string;
    fs.writeFileSync(filePath, freshRecord("newcomer"));

    await repository.release(token);

    expect(fs.readFileSync(filePath, "utf8")).toContain("newcomer");
  });

  it("heartbeat through repeated refreshes keeps reporting ownership", async () => {
    const filePath = lockPath();
    const repository = new RegenerationLockRepository(undefined, filePath);
    const token = (await repository.acquire()) as string;

    expect(await repository.heartbeat(token)).toBe(true);
    expect(await repository.heartbeat(token)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toContain(token);
  });
});
