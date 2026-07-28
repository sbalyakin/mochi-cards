import { describe, expect, it, vi } from "vitest";

import { MacOsKeychainSecretStore } from "./macos-keychain-secret-store";

describe("MacOsKeychainSecretStore", () => {
  it("reads a provider key", async () => {
    const execute = vi.fn(async () => "secret-key\n");
    const store = new MacOsKeychainSecretStore(execute);

    await expect(store.getSecret("openai")).resolves.toBe("secret-key");
    expect(execute).toHaveBeenCalledWith([
      "find-generic-password",
      "-a",
      "openai-api-key",
      "-s",
      "com.sergey-balyakin.raycast.mochi-cards.ai",
      "-w",
    ]);
  });

  it("treats a missing key as unconfigured", async () => {
    const execute = vi.fn(async () => {
      throw { code: 44 };
    });

    await expect(new MacOsKeychainSecretStore(execute).getSecret("gemini")).resolves.toBeUndefined();
  });

  it("saves and deletes a provider key", async () => {
    const execute = vi.fn(async () => "");
    const store = new MacOsKeychainSecretStore(execute);

    await store.setSecret("anthropic", "secret-key");
    await store.setSecret("anthropic", undefined);

    expect(execute).toHaveBeenNthCalledWith(1, [
      "add-generic-password",
      "-U",
      "-a",
      "anthropic-api-key",
      "-s",
      "com.sergey-balyakin.raycast.mochi-cards.ai",
      "-w",
      "secret-key",
    ]);
    expect(execute).toHaveBeenNthCalledWith(2, [
      "delete-generic-password",
      "-a",
      "anthropic-api-key",
      "-s",
      "com.sergey-balyakin.raycast.mochi-cards.ai",
    ]);
  });

  it("does not expose a rejected key in the displayed error", async () => {
    const execute = vi.fn(async () => {
      throw new Error("security failed for secret-key");
    });

    await expect(new MacOsKeychainSecretStore(execute).setSecret("openai", "secret-key")).rejects.toMatchObject({
      message: "Could not save the AI API key to macOS Keychain",
    });
  });
});
