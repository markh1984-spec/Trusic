import { ApiError, type OfflineCollection, type PlayReport, type PlaySource } from "@trusic/client";
import {
  DownloadManager,
  newPlayId,
  PlayOutbox,
  type ManifestStore,
  type OfflineFiles,
  type OfflineManifest,
  type OfflineState,
  type OutboxStorage,
} from "@trusic/player";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { computerName, desktopBridge, type DesktopOfflineBridge } from "./desktop-bridge";

export interface DesktopOffline {
  state: OfflineState;
  /** Whether the Trusic server answers. */
  online: boolean;
  isOn(collection: OfflineCollection): boolean;
  setCollection(collection: OfflineCollection, on: boolean): Promise<void>;
  removeAll(): Promise<void>;
  /** Queue a listen to report, now or when back online. */
  recordPlay(trackId: string, msPlayed: number, source?: PlaySource | null): void;
}

const OfflineContext = createContext<DesktopOffline | null>(null);

/** Downloads and offline listening. Only does anything inside the desktop app. */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const bridge = useMemo(desktopBridge, []);
  if (!bridge) return <>{children}</>;
  return <DesktopOfflineProvider bridge={bridge}>{children}</DesktopOfflineProvider>;
}

/** The desktop app's downloads, or null on the website (so callers can feature-detect). */
export const useDesktopOffline = () => useContext(OfflineContext);

/** Hand downloads to the desktop app's main process, which keeps the files. */
function bridgeFiles(bridge: DesktopOfflineBridge): OfflineFiles {
  return {
    async download(track, url) {
      const result = await bridge.download(track.id, url, track.artworkUrl);
      if (result.ok) return result.bytes;
      if (result.offline) throw new TypeError(result.message);
      throw new ApiError(result.status || 500, result.message);
    },
    remove: (trackIds) => bridge.remove(trackIds),
    removeAll: () => bridge.removeAll(),
    prune: (keep) => bridge.prune([...keep]),
  };
}

function bridgeStore(bridge: DesktopOfflineBridge): ManifestStore {
  return {
    load: async () => ((await bridge.load()).manifest as OfflineManifest | null) ?? null,
    save: (manifest) => bridge.saveManifest(manifest),
  };
}

/** Plays waiting to be sent, per account, in this computer's storage for the app. */
function localOutbox(userId: string): OutboxStorage {
  const key = `trusic.plays.${userId}`;
  return {
    async load() {
      try {
        return JSON.parse(localStorage.getItem(key) ?? "null") as PlayReport[] | null;
      } catch {
        return null;
      }
    },
    async save(plays) {
      try {
        if (plays.length) localStorage.setItem(key, JSON.stringify(plays));
        else localStorage.removeItem(key);
      } catch {
        // Storage unavailable: the plays are still sent while the app stays open.
      }
    },
  };
}

const HOUR = 60 * 60 * 1000;

function DesktopOfflineProvider({ bridge, children }: { bridge: DesktopOfflineBridge; children: ReactNode }) {
  const { me, loading } = useAuth();
  const [device, setDevice] = useState<{ id: string } | null>(null);
  const [online, setOnline] = useState(true);
  const [state, setState] = useState<OfflineState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bridge.load().then((saved) => {
      if (cancelled) return;
      setDevice({ id: saved.deviceId });
      setOnline(saved.online);
    });
    const stop = bridge.onConnectionChange(setOnline);
    return () => {
      cancelled = true;
      stop();
    };
  }, [bridge]);

  const manager = useMemo(
    () =>
      device
        ? new DownloadManager({
            api,
            files: bridgeFiles(bridge),
            store: bridgeStore(bridge),
            device: { id: device.id, name: `Trusic on ${computerName()}`, platform: "desktop" },
          })
        : null,
    [bridge, device],
  );
  useEffect(() => {
    if (!manager) return;
    setState(manager.snapshot);
    return manager.subscribe(setState);
  }, [manager]);

  const userId = me?.user.id ?? null;
  const plan = me?.user.plan ?? null;
  const outbox = useMemo(
    () => (userId ? new PlayOutbox(localOutbox(userId), (p) => api.recordPlays(p)) : null),
    [userId],
  );

  // Downloads belong to the signed-in account. Signing out deletes them.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!manager || loading) return;
    if (!userId) {
      opened.current = null;
      void manager.close();
      return;
    }
    void manager.open(userId).then(() => {
      opened.current = userId;
      void manager.sync();
    });
  }, [manager, userId, loading]);

  // Check in when the plan changes (an ended subscription deletes downloads), and when back online.
  useEffect(() => {
    if (manager && userId && opened.current === userId && online) void manager.sync();
  }, [manager, userId, plan, online]);

  // Send queued plays whenever the server answers, and keep downloads checked while the app stays open.
  useEffect(() => {
    if (online) void outbox?.flush();
  }, [outbox, online]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (manager?.needsCheck()) void manager.sync();
      void outbox?.flush();
    }, HOUR);
    return () => clearInterval(timer);
  }, [manager, outbox]);

  const recordPlay = useCallback(
    (trackId: string, msPlayed: number, source?: PlaySource | null) => {
      if (!outbox) return;
      const playedAt = new Date(Date.now() - msPlayed).toISOString();
      const play = { id: newPlayId(), trackId, playedAt, msPlayed, ...(source ? { source } : {}) };
      void outbox.add(play).then(() => outbox.flush());
    },
    [outbox],
  );

  const value = useMemo<DesktopOffline | null>(
    () =>
      manager && state
        ? {
            state,
            online,
            isOn: (collection) => manager.isCollectionOn(collection),
            setCollection: (collection, on) => manager.setCollection(collection, on),
            removeAll: () => manager.clear(),
            recordPlay,
          }
        : null,
    [manager, state, online, recordPlay],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
