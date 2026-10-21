/**
 * Downloads for listening without signal, shared by the phone app and the
 * desktop app. The rules live here; each app supplies where files and the list
 * of downloads are kept.
 *
 * - Listeners download releases, playlists and liked songs ("collections").
 *   Each check-in with the server ("sync") refreshes their track lists, deletes
 *   tracks that have been taken down or left every collection, and downloads
 *   what's missing.
 * - Downloads belong to one account on one device. Opening another account's
 *   downloads deletes them, and so does signing out (the app calls removeAll).
 * - They play until `validUntil`, 30 days after the last check-in. After that
 *   they wait for the app to get online and check again.
 * - If the subscription has ended, or the account's downloads have moved to
 *   five other devices, the server says so and everything is deleted.
 */
import {
  ApiError,
  type OfflineCollection,
  type OfflineCollectionRef,
  type OfflineDevice,
  type OfflineSync,
  type TrackSummary,
  type TrusicClient,
} from "@trusic/client";

export interface DownloadedTrack {
  track: TrackSummary;
  bytes: number;
  downloadedAt: string;
}

/** Everything a device keeps about its downloads, saved as one document. */
export interface OfflineManifest {
  version: 1;
  accountId: string;
  /** The last successful check-in with the server. */
  checkedAt: string | null;
  /** Downloads play until then. */
  validUntil: string | null;
  /** What the listener chose to download, with each one's latest track list. */
  collections: OfflineCollection[];
  tracks: Record<string, DownloadedTrack>;
}

/** Where downloaded audio lives: the app's private storage, never a plain music folder. */
export interface OfflineFiles {
  /** Fetch a track from a signed URL and keep it. Resolves to its size in bytes. `mimeType` is the audio format. */
  download(track: TrackSummary, url: string, mimeType: string): Promise<number>;
  remove(trackIds: string[]): Promise<void>;
  removeAll(): Promise<void>;
  /** Delete any stray files that aren't in `keep` (say, from a download interrupted by the app closing). */
  prune?(keep: Set<string>): Promise<void>;
  /**
   * Which of these downloaded tracks no longer have a file, for apps that keep downloads somewhere the phone may
   * clear to free space. They're forgotten, and downloaded again at the next check-in.
   */
  missing?(trackIds: string[]): Promise<string[]>;
}

export interface ManifestStore {
  load(): Promise<OfflineManifest | null>;
  /** Null deletes it. */
  save(manifest: OfflineManifest | null): Promise<void>;
}

export type OfflineApi = Pick<TrusicClient, "offlineSync" | "authorizeDownloads">;

export interface DownloadManagerOptions {
  api: OfflineApi;
  files: OfflineFiles;
  store: ManifestStore;
  device: OfflineDevice;
  /** False pauses downloading, e.g. when the phone is on mobile data and "Wi-Fi only" is on. */
  canDownload?: () => boolean;
  now?: () => number;
}

export interface OfflineState {
  /** False until this account's downloads have been loaded. */
  ready: boolean;
  accountId: string | null;
  checkedAt: string | null;
  validUntil: string | null;
  collections: OfflineCollection[];
  tracks: Record<string, DownloadedTrack>;
  /** Storage used by downloads, in bytes. */
  bytes: number;
  /** Checking in or downloading. */
  busy: boolean;
  /** While downloading: how far through. */
  progress: { done: number; total: number } | null;
  /** Tracks still to download, and why they're waiting. */
  waiting: { tracks: number; reason: "wifi" | "offline" } | null;
  /** Something the listener should know, like downloads being removed. */
  notice: string | null;
}

/** "release:<id>", "playlist:<id>" or "liked". */
export const collectionKey = (ref: OfflineCollectionRef | OfflineCollection): string =>
  ref.type === "liked" ? "liked" : `${ref.type}:${ref.id}`;

const toRef = (c: OfflineCollection): OfflineCollectionRef =>
  c.type === "liked" ? { type: "liked" } : { type: c.type, id: c.id! };

/** No connection, or the server is down. Downloads wait for the next check-in. */
export function isOffline(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 502 || error.status === 503 || error.status === 504;
}

/** How often to check in while the app is online, so downloads never come close to expiring. */
export const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

const AUTHORIZE_BATCH = 25;
/** Save the list of downloads after this many new tracks, and at the end. */
const SAVE_EVERY = 10;

export const NOTICES = {
  not_subscribed: "Your downloads have been removed because your subscription has ended.",
  device_removed:
    "Your downloads were removed from this device because you've used downloads on five other devices since. Turn downloads back on to get them again.",
} as const;

/** Storage used, for people: "850 KB", "12.4 MB", "1.2 GB". */
export function storageSize(bytes: number): string {
  if (bytes < 1000 * 1000) return `${Math.max(0, Math.round(bytes / 1000))} KB`;
  if (bytes < 1000 * 1000 * 1000) return `${(bytes / (1000 * 1000)).toFixed(1)} MB`;
  return `${(bytes / (1000 * 1000 * 1000)).toFixed(1)} GB`;
}

const emptyManifest = (accountId: string): OfflineManifest => ({
  version: 1,
  accountId,
  checkedAt: null,
  validUntil: null,
  collections: [],
  tracks: {},
});

export class DownloadManager {
  private manifest: OfflineManifest | null = null;
  private listeners = new Set<(state: OfflineState) => void>();
  private syncing: Promise<void> | null = null;
  /** Collections changed during a sync, so it runs again. */
  private again = false;
  private status: Pick<OfflineState, "busy" | "progress" | "waiting" | "notice"> = {
    busy: false,
    progress: null,
    waiting: null,
    notice: null,
  };
  private state: OfflineState;
  private readonly now: () => number;

  constructor(private readonly options: DownloadManagerOptions) {
    this.now = options.now ?? Date.now;
    this.state = this.buildState();
  }

  get snapshot(): OfflineState {
    return this.state;
  }

  subscribe(listener: (state: OfflineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Load this account's downloads. Another account's downloads on this device are deleted. */
  async open(accountId: string): Promise<void> {
    if (this.manifest?.accountId === accountId) return;
    let saved = await this.options.store.load().catch(() => null);
    if (saved && saved.accountId !== accountId) {
      await this.options.files.removeAll();
      saved = null;
    }
    this.manifest = saved ?? emptyManifest(accountId);
    await this.options.files.prune?.(new Set(Object.keys(this.manifest.tracks))).catch(() => undefined);
    if (await this.forgetLost(this.manifest)) await this.save();
    this.emit();
  }

  /** Forget downloads whose files the phone has deleted, so they're downloaded again. True if any were. */
  private async forgetLost(m: OfflineManifest): Promise<boolean> {
    const lost = (await this.options.files.missing?.(Object.keys(m.tracks)).catch(() => [])) ?? [];
    for (const id of lost) delete m.tracks[id];
    return lost.length > 0;
  }

  /** Delete every download: on signing out, or when the server says so. */
  async removeAll(notice: string | null = null): Promise<void> {
    await this.options.files.removeAll();
    if (this.manifest) this.manifest = emptyManifest(this.manifest.accountId);
    await this.options.store.save(null);
    this.status = { busy: false, progress: null, waiting: null, notice };
    this.emit();
  }

  /** The listener chose "Remove all downloads": delete them and give up this device's place. */
  async clear(): Promise<void> {
    const checkedIn = Boolean(this.manifest?.checkedAt);
    await this.removeAll();
    if (checkedIn) {
      await this.options.api
        .offlineSync({ device: this.options.device, collections: [], trackIds: [] })
        .catch(() => undefined);
    }
  }

  /** Signed out: delete everything and forget the account. */
  async close(): Promise<void> {
    await this.removeAll();
    this.manifest = null;
    this.emit();
  }

  /** Whether downloads can be played now: checked in within the last 30 days. */
  licenceValid(now = this.now()): boolean {
    const until = this.manifest?.validUntil;
    return Boolean(until && now < Date.parse(until));
  }

  isDownloaded(trackId: string): boolean {
    return Boolean(this.manifest?.tracks[trackId]);
  }

  /** Downloaded, and allowed to play offline right now. */
  isPlayable(trackId: string, now = this.now()): boolean {
    return this.isDownloaded(trackId) && this.licenceValid(now);
  }

  isCollectionOn(ref: OfflineCollectionRef | OfflineCollection): boolean {
    const key = collectionKey(ref);
    return Boolean(this.manifest?.collections.some((c) => collectionKey(c) === key));
  }

  /** The downloaded tracks of a collection, in its order. */
  collectionTracks(ref: OfflineCollectionRef | OfflineCollection): TrackSummary[] {
    const key = collectionKey(ref);
    const collection = this.manifest?.collections.find((c) => collectionKey(c) === key);
    if (!collection || !this.manifest) return [];
    return collection.trackIds.map((id) => this.manifest!.tracks[id]?.track).filter((t): t is TrackSummary => !!t);
  }

  /** Due a check-in: never checked, or not for a while. */
  needsCheck(now = this.now()): boolean {
    const m = this.manifest;
    if (!m || (m.collections.length === 0 && Object.keys(m.tracks).length === 0)) return false;
    return !m.checkedAt || now - Date.parse(m.checkedAt) >= CHECK_INTERVAL_MS || this.status.waiting !== null;
  }

  /**
   * Turn downloads on or off for a release, playlist or liked songs. On adds it
   * and downloads its tracks; off deletes tracks no other download needs.
   */
  async setCollection(
    collection: Omit<OfflineCollection, "trackIds"> & { trackIds?: string[] },
    on: boolean,
  ): Promise<void> {
    const m = this.manifest;
    if (!m) return;
    const key = collectionKey(collection as OfflineCollection);
    const without = m.collections.filter((c) => collectionKey(c) !== key);
    if (on) {
      if (without.length === m.collections.length) {
        m.collections.push({ ...collection, trackIds: collection.trackIds ?? [] });
      }
    } else {
      m.collections = without;
      // Works offline too: nothing needs the server to delete.
      await this.removeUnwanted(new Set(m.collections.flatMap((c) => c.trackIds)));
    }
    this.status.notice = null;
    await this.save();
    this.emit();
    await this.sync();
  }

  /**
   * Check in with the server: refresh the collections, delete what's been taken
   * down, and download what's missing. Safe to call often; calls made while one
   * is running wait for it and run once more.
   */
  sync(): Promise<void> {
    if (!this.manifest) return Promise.resolve();
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      this.status.busy = true;
      this.emit();
      try {
        do {
          this.again = false;
          await this.checkIn();
        } while (this.again && this.manifest);
      } finally {
        this.status.busy = false;
        this.status.progress = null;
        this.syncing = null;
        this.emit();
      }
    })();
    return this.syncing;
  }

  private async checkIn(): Promise<void> {
    const m = this.manifest!;
    const { api, device } = this.options;
    const hasAnything = m.collections.length > 0 || Object.keys(m.tracks).length > 0;
    if (!hasAnything && !m.checkedAt) {
      this.status.waiting = null;
      return;
    }

    let result: OfflineSync;
    try {
      result = await api.offlineSync({
        device,
        collections: m.collections.map(toRef),
        trackIds: Object.keys(m.tracks),
      });
    } catch (error) {
      const missing = this.missing(m).length;
      if (isOffline(error)) this.status.waiting = missing ? { tracks: missing, reason: "offline" } : null;
      return;
    }
    if (this.manifest !== m) return;
    if (result.status !== "ok") {
      await this.removeAll(NOTICES[result.status]);
      return;
    }
    if (!hasAnything) {
      // The server has forgotten this device, which frees its place for another.
      m.checkedAt = null;
      m.validUntil = null;
      this.status.waiting = null;
      await this.save();
      return;
    }

    m.checkedAt = result.checkedAt;
    m.validUntil = result.validUntil;
    const fresh = new Map(result.collections.map((c) => [collectionKey(c), c]));
    const gone = new Set(result.unavailable.map((ref) => collectionKey(ref)));
    m.collections = m.collections
      .filter((c) => !gone.has(collectionKey(c)))
      .map((c) => fresh.get(collectionKey(c)) ?? c);
    const allowed = new Map(result.tracks.map((t) => [t.id, t]));
    for (const [id, downloaded] of Object.entries(m.tracks)) {
      const latest = allowed.get(id);
      if (latest) downloaded.track = latest;
    }
    const wanted = new Set(m.collections.flatMap((c) => c.trackIds).filter((id) => allowed.has(id)));
    await this.removeUnwanted(wanted);
    await this.forgetLost(m);
    await this.save();
    this.emit();

    await this.downloadMissing(m, allowed);
  }

  /** Tracks the collections need that aren't downloaded yet. */
  private missing(m: OfflineManifest): string[] {
    return [...new Set(m.collections.flatMap((c) => c.trackIds))].filter((id) => !m.tracks[id]);
  }

  private async downloadMissing(m: OfflineManifest, allowed: Map<string, TrackSummary>) {
    const { api, files, device } = this.options;
    const canDownload = this.options.canDownload ?? (() => true);
    const missing = this.missing(m).filter((id) => allowed.has(id));
    this.status.waiting = null;
    if (missing.length === 0) return;
    if (!canDownload()) {
      this.status.waiting = { tracks: missing.length, reason: "wifi" };
      return;
    }

    const progress = { done: 0, total: missing.length };
    this.status.progress = progress;
    this.emit();
    let unsaved = 0;
    try {
      for (let i = 0; i < missing.length; i += AUTHORIZE_BATCH) {
        // The listener changed what's downloaded, or Wi-Fi went: stop and let the next round decide.
        if (this.again || this.manifest !== m) return;
        if (!canDownload()) {
          this.status.waiting = { tracks: missing.length - progress.done, reason: "wifi" };
          return;
        }
        const batch = missing.slice(i, i + AUTHORIZE_BATCH);
        const auth = await api.authorizeDownloads(device.id, batch);
        for (const link of auth.downloads) {
          const track = allowed.get(link.trackId)!;
          try {
            const bytes = await files.download(track, link.url, link.mimeType);
            if (this.manifest !== m) return;
            m.tracks[track.id] = { track, bytes, downloadedAt: new Date(this.now()).toISOString() };
            if (++unsaved >= SAVE_EVERY) {
              unsaved = 0;
              await this.save();
            }
          } catch (error) {
            if (isOffline(error)) throw error;
            // One bad file shouldn't stop the rest; it's tried again at the next check-in.
          }
          progress.done += 1;
          this.emit();
        }
        progress.done += auth.refusedTrackIds.length;
      }
    } catch (error) {
      const left = this.missing(m).length;
      if (isOffline(error) && left) this.status.waiting = { tracks: left, reason: "offline" };
    } finally {
      if (this.manifest === m) await this.save();
    }
  }

  /** Delete downloaded tracks that aren't in `keep`. */
  private async removeUnwanted(keep: Set<string>) {
    const m = this.manifest!;
    const unwanted = Object.keys(m.tracks).filter((id) => !keep.has(id));
    if (unwanted.length === 0) return;
    await this.options.files.remove(unwanted);
    for (const id of unwanted) delete m.tracks[id];
  }

  private async save() {
    if (this.manifest) await this.options.store.save(this.manifest);
  }

  private buildState(): OfflineState {
    const m = this.manifest;
    const tracks = m?.tracks ?? {};
    return {
      ready: m !== null,
      accountId: m?.accountId ?? null,
      checkedAt: m?.checkedAt ?? null,
      validUntil: m?.validUntil ?? null,
      collections: m ? [...m.collections] : [],
      tracks: { ...tracks },
      bytes: Object.values(tracks).reduce((acc, t) => acc + t.bytes, 0),
      ...this.status,
      progress: this.status.progress ? { ...this.status.progress } : null,
    };
  }

  private emit() {
    this.state = this.buildState();
    for (const listener of this.listeners) listener(this.state);
  }
}
