import type { OfflineCollection, OfflineCollectionRef, PlayReport, TrackSummary } from "@trusic/client";
import { DownloadManager, newPlayId, PlayOutbox, type OfflineManifest, type OfflineState } from "@trusic/player";
import { useNetworkState } from "expo-network";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { api } from "../lib/api";
import { API_URL } from "../lib/config";
import { mayDownload } from "../lib/offline";
import { audioFiles, jsonDocument } from "../lib/offline-storage";
import { serverReachability } from "../lib/reachability";
import { useAuth } from "./auth";

interface OfflineContextValue {
  /** No signal, or the Trusic server can't be reached. Only downloads play. */
  isOffline: boolean;
  state: OfflineState;
  /** Only download on Wi-Fi (on by default, to save mobile data). */
  wifiOnly: boolean;
  setWifiOnly(on: boolean): void;
  /** Downloaded, and checked online in the last 30 days. */
  isPlayable(trackId: string): boolean;
  isOn(ref: OfflineCollectionRef | OfflineCollection): boolean;
  setCollection(collection: OfflineCollection, on: boolean): Promise<void>;
  /** A downloaded collection's tracks that are on the phone, in order. */
  collectionTracks(ref: OfflineCollectionRef): TrackSummary[];
  removeAll(): Promise<void>;
  /** The downloaded copy to play, if it may play now. */
  localUri(trackId: string): Promise<string | null>;
  /** Queue a listen to report, now or when back online. */
  recordPlay(listen: PlayReport): void;
}

const emptyState: OfflineState = {
  ready: false,
  accountId: null,
  checkedAt: null,
  validUntil: null,
  collections: [],
  tracks: {},
  bytes: 0,
  busy: false,
  progress: null,
  waiting: null,
  notice: null,
};

const OfflineContext = createContext<OfflineContextValue | null>(null);

const deviceName = Platform.OS === "ios" ? "iPhone" : Platform.OS === "android" ? "Android phone" : "Web browser";
const platform = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";

/** This install's id for downloads, made up the first time. */
async function loadDeviceId(): Promise<string> {
  const doc = jsonDocument<{ id: string }>("device");
  const saved = await doc.load();
  if (saved?.id) return saved.id;
  const id = `${platform}-${newPlayId()}`;
  await doc.save({ id });
  return id;
}

/**
 * Listening without signal: downloads, offline mode and the play queue.
 *
 * - Downloads belong to the signed-in account. Signing out deletes them, and so does the server
 *   saying the subscription has ended.
 * - They're checked with the server when the app opens, comes back to the front or gets its connection
 *   back, at most every 12 hours (and at least every 30 days, or they stop playing).
 * - Every listen goes into the play queue, which is sent whenever the server can be reached.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const network = useNetworkState();
  const [reachable, setReachable] = useState(serverReachability.get());
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [wifiOnly, setWifiOnlyState] = useState(true);
  const [state, setState] = useState<OfflineState>(emptyState);

  const connected = network.isConnected !== false && network.isInternetReachable !== false;
  const isOffline = !connected || !reachable;
  const downloadAllowed = useRef(true);
  downloadAllowed.current = connected && mayDownload(network, wifiOnly, Platform.OS);

  useEffect(() => serverReachability.subscribe(setReachable), []);
  useEffect(() => {
    void loadDeviceId().then(setDeviceId);
    void jsonDocument<{ wifiOnly: boolean }>("settings")
      .load()
      .then((s) => setWifiOnlyState(s?.wifiOnly ?? true));
  }, []);

  // With signal but no answer from the server: ask it now and then whether it's back.
  useEffect(() => {
    if (reachable || !connected) return;
    const timer = setInterval(() => {
      fetch(`${API_URL}/health`).then(
        (res) => res.ok && serverReachability.report(true),
        () => undefined,
      );
    }, 15_000);
    return () => clearInterval(timer);
  }, [reachable, connected]);

  const manager = useMemo(
    () =>
      deviceId
        ? new DownloadManager({
            api,
            files: audioFiles,
            store: jsonDocument<OfflineManifest>("downloads"),
            device: { id: deviceId, name: deviceName, platform },
            canDownload: () => downloadAllowed.current,
          })
        : null,
    [deviceId],
  );
  useEffect(() => {
    if (!manager) return;
    setState(manager.snapshot);
    return manager.subscribe(setState);
  }, [manager]);

  const userId = me?.user.id ?? null;
  const plan = me?.user.plan ?? null;
  const outbox = useMemo(
    () => (userId ? new PlayOutbox(jsonDocument<PlayReport[]>(`plays-${userId}`), (p) => api.recordPlays(p)) : null),
    [userId],
  );

  // Downloads belong to the signed-in account. Signing out deletes them.
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    if (!manager || loading) return;
    if (!userId) {
      setOpened(null);
      void manager.close();
      return;
    }
    void manager.open(userId).then(() => setOpened(userId));
  }, [manager, userId, loading]);

  // Check in when opened, when the plan changes (an ended subscription deletes downloads), when the
  // connection comes back, and when Wi-Fi arrives for downloads that were waiting for it.
  const canDownloadNow = downloadAllowed.current;
  useEffect(() => {
    if (manager && opened && opened === userId && !isOffline) void manager.sync();
  }, [manager, opened, userId, plan, isOffline, canDownloadNow]);

  useEffect(() => {
    if (!isOffline) void outbox?.flush();
  }, [outbox, isOffline]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      if (manager?.needsCheck()) void manager.sync();
      void outbox?.flush();
    });
    return () => sub.remove();
  }, [manager, outbox]);

  const recordPlay = useCallback(
    (listen: PlayReport) => {
      if (!outbox) return;
      void outbox.add(listen).then(() => outbox.flush());
    },
    [outbox],
  );

  const setWifiOnly = useCallback((on: boolean) => {
    setWifiOnlyState(on);
    void jsonDocument<{ wifiOnly: boolean }>("settings").save({ wifiOnly: on });
  }, []);

  const value = useMemo<OfflineContextValue>(
    () => ({
      isOffline,
      state,
      wifiOnly,
      setWifiOnly,
      isPlayable: (trackId) => manager?.isPlayable(trackId) ?? false,
      isOn: (ref) => manager?.isCollectionOn(ref) ?? false,
      setCollection: async (collection, on) => manager?.setCollection(collection, on),
      collectionTracks: (ref) => manager?.collectionTracks(ref) ?? [],
      removeAll: async () => manager?.clear(),
      localUri: async (trackId) => (manager?.isPlayable(trackId) ? audioFiles.localUri(trackId) : null),
      recordPlay,
    }),
    // `state` changes whenever the downloads do, so the functions above see the latest.
    [isOffline, state, wifiOnly, setWifiOnly, manager, recordPlay],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error("useOffline must be used inside OfflineProvider");
  return ctx;
}

/** A downloaded release, playlist or liked songs, for showing it without a connection. Null if it isn't downloaded. */
export function useDownloadedCollection(ref: OfflineCollectionRef) {
  const offline = useOffline();
  const key = ref.type === "liked" ? "liked" : `${ref.type}:${ref.id}`;
  const collection = offline.state.collections.find(
    (c) => (c.type === "liked" ? "liked" : `${c.type}:${c.id}`) === key,
  );
  if (!collection) return null;
  return { collection, tracks: offline.collectionTracks(ref) };
}
