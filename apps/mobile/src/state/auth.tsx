import type { Me } from "@trusic/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { api, errorMessage, isAuthError } from "../lib/api";
import { tokenStore } from "../lib/token";

interface AuthState {
  me: Me | null;
  /** True until we know whether someone is signed in. */
  loading: boolean;
  /** Set when the server couldn't be reached while checking the saved sign-in. */
  connectionError: string | null;
  /** Whether the listener pays. Non-subscribers only hear previews. */
  subscribed: boolean;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setMe(null);
      return;
    }
    try {
      setMe(await api.me());
      setConnectionError(null);
    } catch (e) {
      // Only a rejected token signs you out. A phone that's offline keeps its sign-in.
      if (isAuthError(e)) {
        await tokenStore.set(null);
        setMe(null);
      } else {
        setConnectionError(errorMessage(e));
      }
    }
  }, []);

  useEffect(() => {
    void tokenStore
      .load()
      .then(refresh)
      .finally(() => setLoading(false));
  }, [refresh]);

  // Subscribing happens on the website, so check again whenever the app comes back.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      connectionError,
      subscribed: me?.user.plan === "premium",
      refresh,
      async login(email, password) {
        const res = await api.login({ email: email.trim(), password });
        await tokenStore.set(res.token);
        await refresh();
      },
      async register(email, password, displayName) {
        const res = await api.register({ email: email.trim(), password, displayName: displayName.trim() });
        await tokenStore.set(res.token);
        await refresh();
      },
      async logout() {
        await api.logout().catch(() => undefined);
        await tokenStore.set(null);
        setMe(null);
      },
    }),
    [me, loading, connectionError, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
