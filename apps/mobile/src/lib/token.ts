import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "trusic.token";

/**
 * The sign-in token. Phones keep it in the encrypted keychain/keystore
 * (expo-secure-store); the browser build uses localStorage.
 *
 * Storage is async but the API client asks for the token synchronously, so we
 * keep a copy in memory and load it once at startup.
 */
let current: string | null = null;

function webStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const tokenStore = {
  get(): string | null {
    return current;
  },

  async load(): Promise<string | null> {
    try {
      current = Platform.OS === "web" ? (webStorage()?.getItem(KEY) ?? null) : await SecureStore.getItemAsync(KEY);
    } catch {
      current = null;
    }
    return current;
  },

  async set(token: string | null): Promise<void> {
    current = token;
    try {
      if (Platform.OS === "web") {
        if (token) webStorage()?.setItem(KEY, token);
        else webStorage()?.removeItem(KEY);
      } else if (token) {
        await SecureStore.setItemAsync(KEY, token);
      } else {
        await SecureStore.deleteItemAsync(KEY);
      }
    } catch {
      // Storage unavailable (e.g. private browsing): the session lasts until the app closes.
    }
  },
};
