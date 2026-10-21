import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { useAuth } from "./auth";

const STORAGE_KEY = "trusic.humanOnly";

interface HumanOnlyState {
  /** Leave tracks labelled Partly AI and AI Slop out of browsing, search, recommendations and radio. */
  humanOnly: boolean;
  setHumanOnly(on: boolean): Promise<void>;
}

const HumanOnlyContext = createContext<HumanOnlyState | null>(null);

function remembered(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function remember(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Private browsing: it lasts until the tab closes.
  }
}

/**
 * The "Human-made only" switch. Signed-in listeners keep it on their account, so it follows them to other
 * devices; visitors keep it in this browser. The last value is remembered locally too, so pages don't show AI
 * tracks for a moment while the account loads.
 */
export function HumanOnlyProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const userId = me?.user.id;
  const [humanOnly, setState] = useState(remembered);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api
      .humanOnly()
      .then((s) => {
        if (cancelled) return;
        setState(s.humanOnly);
        remember(s.humanOnly);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setHumanOnly = useCallback(
    async (on: boolean) => {
      setState(on);
      remember(on);
      if (!userId) return;
      try {
        await api.setHumanOnly(on);
      } catch (e) {
        setState(!on);
        remember(!on);
        throw e;
      }
    },
    [userId],
  );

  const value = useMemo(() => ({ humanOnly, setHumanOnly }), [humanOnly, setHumanOnly]);
  return <HumanOnlyContext.Provider value={value}>{children}</HumanOnlyContext.Provider>;
}

export function useHumanOnly(): HumanOnlyState {
  const ctx = useContext(HumanOnlyContext);
  if (!ctx) throw new Error("useHumanOnly must be used inside HumanOnlyProvider");
  return ctx;
}
