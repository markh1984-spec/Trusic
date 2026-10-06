import { TrusicClient } from "@trusic/client";

const TOKEN_KEY = "trusic.token";

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Private browsing: the session lasts until the tab closes.
    }
  },
};

export const API_BASE: string = import.meta.env.VITE_API_URL ?? "/api";

export const api = new TrusicClient({
  baseUrl: API_BASE,
  getToken: () => tokenStore.get(),
});
