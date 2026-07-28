import { LocalStorage } from "@raycast/api";

import { AiSettingsRepository, type AiSettingsValueStore } from "./ai-settings-repository";
import { MacOsKeychainSecretStore } from "./macos-keychain-secret-store";

const valueStore: AiSettingsValueStore = {
  getItem: (key) => LocalStorage.getItem(key),
  setItem: async (key, value) => {
    await LocalStorage.setItem(key, value);
  },
};

export const aiSettingsRepository = new AiSettingsRepository(valueStore, new MacOsKeychainSecretStore());
