import { ApiError, type Me } from "@trusic/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, tokenStore } from "./api";

interface AuthState {
  me: Me | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** The account as last seen, for when the server can't be reached. */
const lastMe = {
  get(): Me | null {
    try {
      return JSON.parse(localStorage.getItem("trusic.me") ?? "null") as Me | null;
    } catch {
      return null;
    }
  },
  set(me: Me | null) {
    try {
      if (me) localStorage.setItem("trusic.me", JSON.stringify(me));
      else localStorage.removeItem("trusic.me");
    } catch {
      // Private browsing: nothing to remember.
    }
  },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setMe(null);
      return;
    }
    try {
      const fresh = await api.me();
      lastMe.set(fresh);
      setMe(fresh);
    } catch (e) {
      // Only a rejected token signs you out. When the server can't be reached (the desktop app offline),
      // stay signed in as before, so downloads keep playing.
      if (e instanceof ApiError && e.status === 401) {
        tokenStore.set(null);
        lastMe.set(null);
        setMe(null);
      } else {
        setMe(lastMe.get());
      }
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      refresh,
      async login(email, password) {
        const res = await api.login({ email, password });
        tokenStore.set(res.token);
        await refresh();
      },
      async register(email, password, displayName) {
        const res = await api.register({ email, password, displayName });
        tokenStore.set(res.token);
        await refresh();
      },
      async logout() {
        await api.logout().catch(() => undefined);
        tokenStore.set(null);
        lastMe.set(null);
        setMe(null);
      },
    }),
    [me, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
