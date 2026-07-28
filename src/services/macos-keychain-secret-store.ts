import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { AiSettingsSecretStore } from "./ai-settings-repository";

const SECURITY_EXECUTABLE = "/usr/bin/security";
const KEYCHAIN_SERVICE = "com.sergey-balyakin.raycast.mochi-cards.ai";

type SecurityExecutor = (arguments_: readonly string[]) => Promise<string>;

export class MacOsKeychainSecretStore implements AiSettingsSecretStore {
  constructor(private readonly execute: SecurityExecutor = executeSecurity) {}

  async getSecret(provider: "openai" | "gemini" | "anthropic"): Promise<string | undefined> {
    try {
      const value = await this.execute([
        "find-generic-password",
        "-a",
        accountName(provider),
        "-s",
        KEYCHAIN_SERVICE,
        "-w",
      ]);
      return value.trim() || undefined;
    } catch (error: unknown) {
      if (isMissingKeychainItem(error)) {
        return undefined;
      }
      throw new Error("Could not read the AI API key from macOS Keychain", { cause: error });
    }
  }

  async setSecret(provider: "openai" | "gemini" | "anthropic", value: string | undefined): Promise<void> {
    if (!value) {
      await this.deleteSecret(provider);
      return;
    }
    try {
      await this.execute([
        "add-generic-password",
        "-U",
        "-a",
        accountName(provider),
        "-s",
        KEYCHAIN_SERVICE,
        "-w",
        value,
      ]);
    } catch (error: unknown) {
      throw new Error("Could not save the AI API key to macOS Keychain", { cause: error });
    }
  }

  private async deleteSecret(provider: "openai" | "gemini" | "anthropic"): Promise<void> {
    try {
      await this.execute(["delete-generic-password", "-a", accountName(provider), "-s", KEYCHAIN_SERVICE]);
    } catch (error: unknown) {
      if (!isMissingKeychainItem(error)) {
        throw new Error("Could not remove the AI API key from macOS Keychain", { cause: error });
      }
    }
  }
}

async function executeSecurity(arguments_: readonly string[]): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("macOS Keychain is unavailable on this platform");
  }
  const result = await promisify(execFile)(SECURITY_EXECUTABLE, [...arguments_], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return result.stdout;
}

function accountName(provider: "openai" | "gemini" | "anthropic"): string {
  return `${provider}-api-key`;
}

function isMissingKeychainItem(error: unknown): boolean {
  return isRecord(error) && error.code === 44;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
