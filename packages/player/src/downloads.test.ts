import type {
  DownloadAuthorization,
  OfflineCollection,
  OfflineCollectionRef,
  OfflineSync,
  OfflineSyncRequest,
  TrackSummary,
} from "@trusic/client";
import { describe, expect, it } from "vitest";
import {
  DownloadManager,
  NOTICES,
  storageSize,
  type ManifestStore,
  type OfflineFiles,
  type OfflineManifest,
} from "./downloads";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-21T12:00:00Z");

const track = (id: string): TrackSummary => ({
  id,
  title: `Track ${id}`,
  genre: null,
  durationMs: 180_000,
  artist: { id: "artist", name: "The Band", slug: "the-band" },
  release: null,
  trackNumber: null,
  artworkUrl: null,
  aiScore: 0,
  aiLabel: "human",
  payoutRatePercent: 100,
  scoreSource: "declared",
  flagged: false,
  createdAt: "2026-10-01T00:00:00.000Z",
});

/** A pretend Trusic server: collections, which tracks are live, and whether the listener subscribes. */
function fakeServer() {
  const server = {
    online: true,
    subscribed: true,
    deviceRemoved: false,
    collections: new Map<string, { title: string; trackIds: string[] }>([
      ["release:r1", { title: "The EP", trackIds: ["a", "b"] }],
      ["playlist:p1", { title: "Mix", trackIds: ["b", "c"] }],
      ["liked", { title: "Liked songs", trackIds: ["d"] }],
    ]),
    takenDown: new Set<string>(),
    syncs: [] as OfflineSyncRequest[],
    authorized: [] as string[],
    now: NOW,
    api: {
      offlineSync: async (input: OfflineSyncRequest): Promise<OfflineSync> => {
        if (!server.online) throw new TypeError("Network request failed");
        server.syncs.push(input);
        const checkedAt = new Date(server.now).toISOString();
        const status = !server.subscribed ? "not_subscribed" : server.deviceRemoved ? "device_removed" : "ok";
        if (status !== "ok") {
          return {
            status,
            checkedAt,
            validUntil: null,
            collections: [],
            unavailable: [],
            tracks: [],
            removedTrackIds: input.trackIds,
          };
        }
        const collections: OfflineCollection[] = [];
        const unavailable: OfflineCollectionRef[] = [];
        for (const ref of input.collections) {
          const key = ref.type === "liked" ? "liked" : `${ref.type}:${ref.id}`;
          const found = server.collections.get(key);
          if (!found) unavailable.push(ref);
          else
            collections.push({
              type: ref.type,
              id: ref.type === "liked" ? null : ref.id,
              title: found.title,
              subtitle: null,
              artworkUrl: null,
              trackIds: found.trackIds.filter((id) => !server.takenDown.has(id)),
            });
        }
        const wanted = [...new Set([...collections.flatMap((c) => c.trackIds), ...input.trackIds])];
        return {
          status,
          checkedAt,
          validUntil: new Date(server.now + 30 * DAY).toISOString(),
          collections,
          unavailable,
          tracks: wanted.filter((id) => !server.takenDown.has(id)).map(track),
          removedTrackIds: input.trackIds.filter((id) => server.takenDown.has(id)),
        };
      },
      authorizeDownloads: async (_deviceId: string, trackIds: string[]): Promise<DownloadAuthorization> => {
        if (!server.online) throw new TypeError("Network request failed");
        server.authorized.push(...trackIds);
        return {
          downloads: trackIds.map((id) => ({
            trackId: id,
            url: `/api/stream/${id}?sig=x`,
            expiresAt: "",
            bytes: 1000,
            mimeType: "audio/mpeg",
          })),
          refusedTrackIds: [],
        };
      },
    },
  };
  return server;
}

/** Files on the pretend device. */
function fakeDevice(server: ReturnType<typeof fakeServer>) {
  const disk = new Map<string, string>();
  const saved: { manifest: OfflineManifest | null } = { manifest: null };
  const files: OfflineFiles = {
    async download(t, url) {
      if (!server.online) throw new TypeError("Network request failed");
      disk.set(t.id, url);
      return 1000;
    },
    async remove(ids) {
      for (const id of ids) disk.delete(id);
    },
    async removeAll() {
      disk.clear();
    },
    async prune(keep) {
      for (const id of [...disk.keys()]) if (!keep.has(id)) disk.delete(id);
    },
  };
  const store: ManifestStore = {
    load: async () => (saved.manifest ? structuredClone(saved.manifest) : null),
    save: async (m) => {
      saved.manifest = m ? structuredClone(m) : null;
    },
  };
  return { disk, saved, files, store };
}

function setup(options: { canDownload?: () => boolean } = {}) {
  const server = fakeServer();
  const device = fakeDevice(server);
  const make = () =>
    new DownloadManager({
      api: server.api,
      files: device.files,
      store: device.store,
      device: { id: "device-1234", name: "Test phone", platform: "ios" },
      canDownload: options.canDownload,
      now: () => server.now,
    });
  return { server, device, manager: make(), make };
}

const release = { type: "release" as const, id: "r1", title: "The EP", subtitle: null, artworkUrl: null };
const playlist = { type: "playlist" as const, id: "p1", title: "Mix", subtitle: null, artworkUrl: null };
const liked = { type: "liked" as const, id: null, title: "Liked songs", subtitle: null, artworkUrl: null };

describe("DownloadManager", () => {
  it("downloads a collection's tracks and plays them for 30 days after checking in", async () => {
    const { server, device, manager } = setup();
    await manager.open("user-1");
    await manager.setCollection(release, true);

    expect([...device.disk.keys()].sort()).toEqual(["a", "b"]);
    expect(manager.isCollectionOn({ type: "release", id: "r1" })).toBe(true);
    expect(manager.collectionTracks({ type: "release", id: "r1" }).map((t) => t.id)).toEqual(["a", "b"]);
    expect(manager.snapshot.bytes).toBe(2000);
    expect(manager.isPlayable("a")).toBe(true);
    expect(manager.isPlayable("a", NOW + 29 * DAY)).toBe(true);
    // A month without checking in: the downloads stay, but don't play until the app is back online.
    expect(manager.isPlayable("a", NOW + 31 * DAY)).toBe(false);
    expect(manager.isDownloaded("a")).toBe(true);
    expect(server.syncs[0]).toMatchObject({ collections: [{ type: "release", id: "r1" }], trackIds: [] });
  });

  it("shares tracks between collections, and only deletes a track when nothing needs it", async () => {
    const { device, manager } = setup();
    await manager.open("user-1");
    await manager.setCollection(release, true);
    await manager.setCollection(playlist, true);
    expect([...device.disk.keys()].sort()).toEqual(["a", "b", "c"]);

    await manager.setCollection(release, false);
    expect([...device.disk.keys()].sort()).toEqual(["b", "c"]);
  });

  it("removes tracks taken down at the next check-in, and picks up new ones", async () => {
    const { server, device, manager } = setup();
    await manager.open("user-1");
    await manager.setCollection(playlist, true);
    server.takenDown.add("b");
    server.collections.get("playlist:p1")!.trackIds.push("e");
    await manager.sync();
    expect([...device.disk.keys()].sort()).toEqual(["c", "e"]);
    expect(server.syncs.at(-1)?.trackIds.sort()).toEqual(["b", "c"]);
  });

  it("drops a collection that has gone", async () => {
    const { server, device, manager } = setup();
    await manager.open("user-1");
    await manager.setCollection(playlist, true);
    server.collections.delete("playlist:p1");
    await manager.sync();
    expect(manager.snapshot.collections).toEqual([]);
    expect(device.disk.size).toBe(0);
  });

  it("deletes everything when the subscription ends, and says why", async () => {
    const { server, device, manager } = setup();
    await manager.open("user-1");
    await manager.setCollection(release, true);
    server.subscribed = false;
    await manager.sync();
    expect(device.disk.size).toBe(0);
    expect(device.saved.manifest).toBeNull();
    expect(manager.snapshot.collections).toEqual([]);
    expect(manager.snapshot.notice).toBe(NOTICES.not_subscribed);
  });

  it("deletes everything when downloads have moved to too many other devices", async () => {
    const { server, device, manager } = setup();
    await manager.open("user-1");
    await manager.setCollection(liked, true);
    server.deviceRemoved = true;
    await manager.sync();
    expect(device.disk.size).toBe(0);
    expect(manager.snapshot.notice).toBe(NOTICES.device_removed);
  });

  it("keeps downloads to one account: opening another account's deletes them", async () => {
    const { device, manager, make } = setup();
    await manager.open("user-1");
    await manager.setCollection(release, true);
    expect(device.disk.size).toBe(2);

    const next = make();
    await next.open("user-1");
    expect(next.isDownloaded("a")).toBe(true);

    const other = make();
    await other.open("user-2");
    expect(device.disk.size).toBe(0);
    expect(other.snapshot.collections).toEqual([]);
  });

  it("deletes everything on signing out", async () => {
    const { device, manager } = setup();
    await manager.open("user-1");
    await manager.setCollection(release, true);
    await manager.close();
    expect(device.disk.size).toBe(0);
    expect(device.saved.manifest).toBeNull();
    expect(manager.snapshot.ready).toBe(false);
  });

  it("waits for a connection, and finishes downloading once back online", async () => {
    const { server, device, manager } = setup();
    await manager.open("user-1");
    server.online = false;
    await manager.setCollection(release, true);
    expect(manager.isCollectionOn({ type: "release", id: "r1" })).toBe(true);
    expect(device.disk.size).toBe(0);
    expect(manager.needsCheck()).toBe(true);

    server.online = true;
    await manager.sync();
    expect([...device.disk.keys()].sort()).toEqual(["a", "b"]);
    expect(manager.snapshot.waiting).toBeNull();
  });

  it("waits for Wi-Fi when told to", async () => {
    let wifi = false;
    const { device, manager } = setup({ canDownload: () => wifi });
    await manager.open("user-1");
    await manager.setCollection(release, true);
    expect(device.disk.size).toBe(0);
    expect(manager.snapshot.waiting).toEqual({ tracks: 2, reason: "wifi" });

    wifi = true;
    await manager.sync();
    expect(device.disk.size).toBe(2);
  });

  it("turns a collection off without a connection", async () => {
    const { server, device, manager } = setup();
    await manager.open("user-1");
    await manager.setCollection(release, true);
    server.online = false;
    await manager.setCollection(release, false);
    expect(device.disk.size).toBe(0);
    expect(manager.snapshot.collections).toEqual([]);
  });

  it("tidies up files left by a download the app didn't finish saving", async () => {
    const { device, manager } = setup();
    device.disk.set("stray", "partial");
    await manager.open("user-1");
    expect(device.disk.has("stray")).toBe(false);
  });

  it("checks in again after 12 hours, and tells the server when it keeps nothing", async () => {
    const { server, manager } = setup();
    await manager.open("user-1");
    expect(manager.needsCheck()).toBe(false);
    await manager.setCollection(release, true);
    expect(manager.needsCheck()).toBe(false);
    server.now += 13 * 60 * 60 * 1000;
    expect(manager.needsCheck()).toBe(true);

    await manager.setCollection(release, false);
    expect(server.syncs.at(-1)).toMatchObject({ collections: [], trackIds: [] });
    expect(manager.snapshot.checkedAt).toBeNull();
  });

  it("removes everything on request, and frees this device's place on the server", async () => {
    const { server, device, manager } = setup();
    await manager.open("user-1");
    await manager.setCollection(release, true);
    await manager.setCollection(liked, true);
    await manager.clear();
    expect(device.disk.size).toBe(0);
    expect(manager.snapshot).toMatchObject({ collections: [], bytes: 0, notice: null });
    expect(server.syncs.at(-1)).toMatchObject({ collections: [], trackIds: [] });
  });

  it("shows storage in units people know", () => {
    expect(storageSize(850_000)).toBe("850 KB");
    expect(storageSize(12_400_000)).toBe("12.4 MB");
    expect(storageSize(1_250_000_000)).toBe("1.3 GB");
  });
});

describe("downloads the phone has cleared away", () => {
  /** Files kept where the phone may delete them to free space (an app's cache folder). */
  function clearable() {
    const server = fakeServer();
    const device = fakeDevice(server);
    const files: OfflineFiles = {
      ...device.files,
      missing: async (ids) => ids.filter((id) => !device.disk.has(id)),
    };
    const make = () =>
      new DownloadManager({
        api: server.api,
        files,
        store: device.store,
        device: { id: "device-1234", name: "Test phone", platform: "ios" },
        now: () => server.now,
      });
    return { server, device, make };
  }

  it("are forgotten when the app opens, then downloaded again at the next check-in", async () => {
    const { server, device, make } = clearable();
    const first = make();
    await first.open("user-1");
    await first.setCollection(release, true);
    device.disk.clear();

    server.online = false;
    const next = make();
    await next.open("user-1");
    expect(next.isDownloaded("a")).toBe(false);
    expect(next.snapshot.bytes).toBe(0);
    expect(device.saved.manifest?.tracks).toEqual({});

    server.online = true;
    await next.sync();
    expect([...device.disk.keys()].sort()).toEqual(["a", "b"]);
    expect(next.isPlayable("a")).toBe(true);
  });

  it("are noticed at a check-in while the app is open", async () => {
    const { device, make } = clearable();
    const manager = make();
    await manager.open("user-1");
    await manager.setCollection(release, true);
    device.disk.delete("b");
    await manager.sync();
    expect([...device.disk.keys()].sort()).toEqual(["a", "b"]);
  });
});
