import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./api";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  /** What went wrong, as thrown, e.g. to tell "not found" from "no signal". */
  cause: unknown;
  loading: boolean;
  /** Load again, e.g. for pull to refresh. */
  reload(): void;
}

/** Load data for a screen, re-running whenever `deps` change. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<{ error: string; cause: unknown } | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailure(null);
    load()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setFailure({ error: errorMessage(e), cause: e });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error: failure?.error ?? null, cause: failure?.cause ?? null, loading, reload };
}
