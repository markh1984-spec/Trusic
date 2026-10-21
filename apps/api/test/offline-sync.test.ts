import type {
  DownloadAuthorization,
  OfflineCollectionRef,
  OfflineSync,
  OfflineSyncRequest,
  PlaylistDetail,
  ReleaseDetail,
  TrackDetail,
} from "@trusic/client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tracks } from "../src/db/schema";
import { call, createTestApp, declaration, register, sendFile, wav, type TestApp } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

let t: TestApp;
let band: { token: string; id: string };
let fan: { token: string; id: string };
let free: { token: string; id: string };
const track: Record<string, string> = {};
let releaseId = "";
let playlistId = "";
let privatePlaylistId = "";
let collections: OfflineCollectionRef[] = [];

const device = (n: number): OfflineSyncRequest["device"] => ({
  id: `device-${n}-abcdef`,
  name: `Phone ${n}`,
  platform: "ios",
});
const sync = (who: { token: string }, body: Partial<OfflineSyncRequest> & { device: OfflineSyncRequest["device"] }) =>
  call<OfflineSync>(t, "POST", "/api/offline/sync", who.token, { collections: [], trackIds: [], ...body });
const authorize = (who: { token: string }, deviceId: string, trackIds: string[]) =>
  call<DownloadAuthorization>(t, "POST", "/api/offline/downloads", who.token, { deviceId, trackIds });

beforeAll(async () => {
  t = await createTestApp();
  band = await register(t, "band@trusic.test");
  fan = await register(t, "fan@trusic.test");
  free = await register(t, "free@trusic.test");
  await call(t, "POST", "/api/billing/subscribe", fan.token);

  const artist = (await call<{ id: string }>(t, "POST", "/api/artists", band.token, { name: "The Band" })).body;
  for (const title of ["A", "B", "C", "D"]) {
    const res = await sendFile(
      t,
      "POST",
      "/api/tracks",
      band.token,
      { artistId: artist.id, title, declaration: JSON.stringify(declaration()) },
      { name: "audio", filename: `${title}.wav`, data: wav({ seconds: 40, seed: title.charCodeAt(0) }) },
    );
    track[title] = (res.body as TrackDetail).id;
  }
  const release = await call<ReleaseDetail>(t, "POST", "/api/releases", band.token, {
    artistId: artist.id,
    title: "The EP",
    type: "ep",
  });
  releaseId = release.body.id;
  await call(t, "PUT", `/api/releases/${releaseId}/tracks`, band.token, { trackIds: [track.A, track.B] });

  const playlist = await call<PlaylistDetail>(t, "POST", "/api/playlists", fan.token, { name: "Mix" });
  playlistId = playlist.body.id;
  await call(t, "POST", `/api/playlists/${playlistId}/entries`, fan.token, { trackIds: [track.A, track.C, track.C] });
  await call(t, "PUT", `/api/me/likes/${track.D}`, fan.token);
  const hidden = await call<PlaylistDetail>(t, "POST", "/api/playlists", band.token, {
    name: "Secret",
    isPublic: false,
  });
  privatePlaylistId = hidden.body.id;

  collections = [{ type: "release", id: releaseId }, { type: "playlist", id: playlistId }, { type: "liked" }];
});
afterAll(async () => {
  await t?.close();
});

describe("checking a device's downloads", () => {
  it("tells someone who isn't subscribed to delete everything", async () => {
    const res = await sync(free, { device: device(9), collections, trackIds: [track.A!] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "not_subscribed",
      validUntil: null,
      tracks: [],
      removedTrackIds: [track.A],
    });
    expect((await authorize(free, device(9).id, [track.A!])).status).toBe(403);
  });

  it("lists what a subscriber's device may keep, for 30 days", async () => {
    const res = await sync(fan, { device: device(1), collections });
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.status).toBe("ok");
    expect(Date.parse(body.validUntil!) - Date.parse(body.checkedAt)).toBe(30 * DAY);
    expect(body.collections.map((c) => [c.type, c.title, c.trackIds])).toEqual([
      ["release", "The EP", [track.A, track.B]],
      ["playlist", "Mix", [track.A, track.C]],
      ["liked", "Liked songs", [track.D]],
    ]);
    expect(body.collections[0]!.subtitle).toBe("The Band");
    expect(body.tracks.map((x) => x.title).sort()).toEqual(["A", "B", "C", "D"]);
    expect(body.removedTrackIds).toEqual([]);
  });

  it("hands out signed links that download the whole track", async () => {
    expect((await authorize(fan, "never-checked-in", [track.A!])).status).toBe(409);
    const res = await authorize(fan, device(1).id, [track.A!, track.B!]);
    expect(res.status).toBe(200);
    expect(res.body.refusedTrackIds).toEqual([]);
    const [first] = res.body.downloads;
    expect(Date.parse(first!.expiresAt) - Date.now()).toBeGreaterThan(20 * 60 * 60 * 1000);
    const file = await t.app.inject({ method: "GET", url: first!.url });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.length).toBe(first!.bytes);
    expect(first!.mimeType).toMatch(/^audio\//);
    // The link is for this track only.
    const forged = first!.url.replace(first!.trackId, track.C!);
    expect((await t.app.inject({ method: "GET", url: forged })).statusCode).toBe(403);
  });

  it("removes taken-down and suspended tracks at the next check", async () => {
    await call(t, "DELETE", `/api/tracks/${track.B}`, band.token);
    await t.database.db.update(tracks).set({ status: "suspended" }).where(eq(tracks.id, track.C!));

    const res = await sync(fan, {
      device: device(1),
      collections,
      trackIds: [track.A!, track.B!, track.C!, track.D!],
    });
    expect(res.body.removedTrackIds.sort()).toEqual([track.B, track.C].sort());
    expect(res.body.collections.map((c) => c.trackIds)).toEqual([[track.A], [track.A], [track.D]]);
    expect(res.body.tracks.map((x) => x.title).sort()).toEqual(["A", "D"]);
    expect((await authorize(fan, device(1).id, [track.B!, track.D!])).body.refusedTrackIds).toEqual([track.B]);
    await t.database.db.update(tracks).set({ status: "live" }).where(eq(tracks.id, track.C!));
  });

  it("drops collections that have gone or can no longer be seen", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const res = await sync(fan, {
      device: device(1),
      collections: [{ type: "playlist", id: privatePlaylistId }, { type: "release", id: missing }, { type: "liked" }],
    });
    expect(res.body.unavailable).toEqual([
      { type: "playlist", id: privatePlaylistId },
      { type: "release", id: missing },
    ]);
    expect(res.body.collections.map((c) => c.type)).toEqual(["liked"]);
  });

  it("keeps downloads on up to five devices, pushing out the one used least recently", async () => {
    for (const n of [2, 3, 4, 5]) expect((await sync(fan, { device: device(n), collections })).body.status).toBe("ok");
    // Device 1 checked in last, so device 2 is the least recently used when a sixth arrives.
    await sync(fan, { device: device(1), collections });
    expect((await sync(fan, { device: device(6), collections })).body.status).toBe("ok");

    const pushedOut = await sync(fan, { device: device(2), collections, trackIds: [track.A!] });
    expect(pushedOut.body).toMatchObject({ status: "device_removed", removedTrackIds: [track.A] });
    // Downloading again on that device registers it afresh (and pushes out the next oldest).
    expect((await sync(fan, { device: device(2), collections })).body.status).toBe("ok");
    expect((await sync(fan, { device: device(3), collections })).body.status).toBe("device_removed");
  });

  it("forgets a device that keeps nothing", async () => {
    expect((await sync(fan, { device: device(4) })).body.status).toBe("ok");
    expect((await authorize(fan, device(4).id, [track.A!])).status).toBe(409);
  });

  it("tells every device to delete its downloads once the subscription ends", async () => {
    await call(t, "POST", "/api/billing/cancel", fan.token);
    const res = await sync(fan, { device: device(1), collections, trackIds: [track.A!, track.D!] });
    expect(res.body).toMatchObject({ status: "not_subscribed", removedTrackIds: [track.A, track.D] });
    expect((await authorize(fan, device(1).id, [track.A!])).status).toBe(403);
  });

  it("needs a login", async () => {
    expect(
      (await call(t, "POST", "/api/offline/sync", undefined, { device: device(1), collections: [], trackIds: [] }))
        .status,
    ).toBe(401);
  });
});
