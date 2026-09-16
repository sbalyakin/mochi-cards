import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

export class ExtensionDataFileExistsError extends Error {
  constructor(path: string, options?: ErrorOptions) {
    super(`The file already exists: ${path}`, options);
    this.name = "ExtensionDataFileExistsError";
  }
}

export async function saveExtensionDataFile(
  directory: string,
  requestedFilename: string,
  content: string,
  overwrite: boolean
): Promise<string> {
  const resolvedDirectory = resolve(directory);
  const path = resolve(resolvedDirectory, sanitizeExtensionDataFilename(requestedFilename));
  if (dirname(path) !== resolvedDirectory) {
    throw new Error("The selected filename points outside the destination directory");
  }

  const stagingPath = overwrite ? `${path}.${randomUUID()}.tmp` : path;
  try {
    writeExclusive(stagingPath, content);
    if (overwrite) {
      fs.renameSync(stagingPath, path);
    }
    return path;
  } catch (error: unknown) {
    if (!overwrite && isNodeError(error) && error.code === "EEXIST") {
      throw new ExtensionDataFileExistsError(path, { cause: error });
    }
    throw error;
  } finally {
    if (overwrite) {
      removeStagingFile(stagingPath);
    }
  }
}

function writeExclusive(path: string, content: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(path, "wx");
    const bytes = Buffer.from(content, "utf8");
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
      if (written === 0) {
        throw new Error("Could not finish writing the extension data file");
      }
      offset += written;
    }
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
  }
}

function removeStagingFile(path: string): void {
  try {
    fs.unlinkSync(path);
  } catch (error: unknown) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function readExtensionDataFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function extensionDataFileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function sanitizeExtensionDataFilename(requestedFilename: string): string {
  const sanitized = requestedFilename
    .trim()
    .replace(/[\\/:*?"<>|\0]/g, "-")
    .replace(/^\.+$/, "")
    .trim();
  const base = sanitized.length > 0 ? sanitized : "mochi-cards-data";
  return extname(base).toLowerCase() === ".json" ? base : `${base}.json`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
