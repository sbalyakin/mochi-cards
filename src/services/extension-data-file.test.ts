import fs from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ExtensionDataFileExistsError,
  readExtensionDataFile,
  sanitizeExtensionDataFilename,
  saveExtensionDataFile,
} from "./extension-data-file";

describe("extension data file", () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("sanitizes filenames and always uses the .json extension", () => {
    expect(sanitizeExtensionDataFilename("../Mochi: data")).toBe("..-Mochi- data.json");
    expect(sanitizeExtensionDataFilename("backup.JSON")).toBe("backup.JSON");
    expect(sanitizeExtensionDataFilename("...")).toBe("mochi-cards-data.json");
  });

  it("reads and writes UTF-8 and requires explicit overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mochi-cards-data-test-"));
    directories.push(directory);

    const path = await saveExtensionDataFile(directory, "backup", "данные", false);
    expect(await readFile(path, "utf8")).toBe("данные");
    expect(await readExtensionDataFile(path)).toBe("данные");
    await expect(saveExtensionDataFile(directory, "backup.json", "новые", false)).rejects.toBeInstanceOf(
      ExtensionDataFileExistsError
    );

    await saveExtensionDataFile(directory, "backup.json", "новые", true);
    expect(await readFile(path, "utf8")).toBe("новые");
  });

  it("allows only one concurrent create without overwrite confirmation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mochi-cards-data-test-"));
    directories.push(directory);

    const results = await Promise.allSettled([
      saveExtensionDataFile(directory, "backup", "first", false),
      saveExtensionDataFile(directory, "backup", "second", false),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected");
    expect(failure?.reason).toBeInstanceOf(ExtensionDataFileExistsError);
  });

  it("keeps the existing backup when staging fails during overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mochi-cards-data-test-"));
    directories.push(directory);
    const path = await saveExtensionDataFile(directory, "backup", "existing", false);
    vi.spyOn(fs, "writeSync").mockImplementationOnce(() => {
      throw new Error("disk write failed");
    });

    await expect(saveExtensionDataFile(directory, "backup", "replacement", true)).rejects.toThrow("disk write failed");

    expect(await readFile(path, "utf8")).toBe("existing");
    expect(await readdir(directory)).toEqual(["backup.json"]);
  });
});
