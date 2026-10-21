import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { jsonDocument } from "../lib/offline-storage";
import { useAuth } from "./auth";

interface HumanOnlyState {
  /** Leave tracks labelled Partly AI and AI Slop out of browsing, search, recommendations and radio. */
  humanOnly: boolean;
  setHumanOnly(on: boolean): Promise<void>;
}

const HumanOnlyContext = createContext<HumanOnlyState | null>(null);

/** The last value, kept on the phone: a visitor's choice, and the account's while it loads. */
const saved = jsonDocument<{ humanOnly: boolean }>("human-only");

/**
 * The "Human-made only" switch. Signed-in listeners keep it on their account, so it follows them to the website
 * and other devices; visitors keep it on this phone. Screens send it with each request, as the website does, so
 * a visitor's choice counts too.
 *
 * Nothing is shown until the phone's copy has loaded (a moment), so screens never flash tracks the listener has
 * asked not to see.
 */
export function HumanOnlyProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const userId = me?.user.id;
  const [humanOnly, setState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /** Goes up whenever the listener flips the switch, so an older answer from the server can't undo it. */
  const changes = useRef(0);

  useEffect(() => {
    void saved
      .load()
      .then((s) => {
        if (s && changes.current === 0) setState(s.humanOnly);
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const asked = changes.current;
    api
      .humanOnly()
      .then((s) => {
        if (cancelled || changes.current !== asked) return;
        setState(s.humanOnly);
        void saved.save(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setHumanOnly = useCallback(
    async (on: boolean) => {
      const change = ++changes.current;
      setState(on);
      void saved.save({ humanOnly: on });
      if (!userId) return;
      try {
        await api.setHumanOnly(on);
      } catch (e) {
        // Put it back, unless the listener has flipped it again since.
        if (changes.current === change) {
          setState(!on);
          void saved.save({ humanOnly: !on });
        }
        throw e;
      }
    },
    [userId],
  );

  const value = useMemo(() => ({ humanOnly, setHumanOnly }), [humanOnly, setHumanOnly]);
  if (!loaded) return null;
  return <HumanOnlyContext.Provider value={value}>{children}</HumanOnlyContext.Provider>;
}

export function useHumanOnly(): HumanOnlyState {
  const ctx = useContext(HumanOnlyContext);
  if (!ctx) throw new Error("useHumanOnly must be used inside HumanOnlyProvider");
  return ctx;
}
