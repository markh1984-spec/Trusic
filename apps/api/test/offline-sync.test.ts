import { randomUUID } from "node:crypto";
import type {
  DownloadAuthorization,
  DownloadDevice,
  OfflineCollectionRef,
  OfflineSync,
  OfflineSyncRequest,
  PlayBatchResult,
  PlaylistDetail,
  ReleaseDetail,
  TrackDetail,
} from "@trusic/client";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { offlineDevices, subscriptionPeriods, tracks } from "../src/db/schema";
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
    // Removed by the band, suspended after three strikes, and taken down after a report.
    await call(t, "DELETE", `/api/tracks/${track.B}`, band.token);
    await t.database.db.update(tracks).set({ status: "suspended" }).where(eq(tracks.id, track.C!));
    await t.database.db.update(tracks).set({ status: "taken_down" }).where(eq(tracks.id, track.D!));

    const res = await sync(fan, {
      device: device(1),
      collections,
      trackIds: [track.A!, track.B!, track.C!, track.D!],
    });
    expect(res.body.removedTrackIds.sort()).toEqual([track.B, track.C, track.D].sort());
    expect(res.body.collections.map((c) => c.trackIds)).toEqual([[track.A], [track.A], []]);
    expect(res.body.tracks.map((x) => x.title)).toEqual(["A"]);
    expect((await authorize(fan, device(1).id, [track.B!, track.D!])).body.refusedTrackIds).toEqual([track.B, track.D]);
    // Plays of a taken-down track that reach us afterwards don't count either.
    const late = { id: randomUUID(), trackId: track.D!, playedAt: new Date().toISOString(), msPlayed: 40_000 };
    expect((await call<PlayBatchResult>(t, "POST", "/api/plays/batch", fan.token, { plays: [late] })).body).toEqual({
      results: [{ id: late.id, status: "rejected", reason: "unavailable" }],
    });
    await t.database.db
      .update(tracks)
      .set({ status: "live" })
      .where(inArray(tracks.id, [track.C!, track.D!]));
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

  it("includes download devices and subscription history in 'Your data', and deletes them with the account", async () => {
    const leaver = await register(t, "leaver@trusic.test");
    await call(t, "POST", "/api/billing/subscribe", leaver.token);
    await sync(leaver, { device: device(7), collections: [{ type: "liked" }] });
    const data = (
      await t.app.inject({ method: "GET", url: "/api/me/export", headers: { authorization: `Bearer ${leaver.token}` } })
    ).json();
    expect(data.downloadDevices).toMatchObject([{ name: "Phone 7", platform: "ios" }]);
    expect(data.subscriptionHistory).toHaveLength(1);
    expect(data.subscriptionHistory[0].endedAt).toBeNull();

    const gone = await call(t, "POST", "/api/me/delete", leaver.token, {
      password: "correct horse battery",
      confirm: "DELETE",
    });
    expect(gone.status).toBe(204);
    const { db } = t.database;
    expect(await db.select().from(offlineDevices).where(eq(offlineDevices.userId, leaver.id))).toEqual([]);
    expect(await db.select().from(subscriptionPeriods).where(eq(subscriptionPeriods.userId, leaver.id))).toEqual([]);
  });

  it("needs a login", async () => {
    expect(
      (await call(t, "POST", "/api/offline/sync", undefined, { device: device(1), collections: [], trackIds: [] }))
        .status,
    ).toBe(401);
  });
});

describe("your devices", () => {
  let listener: { token: string; id: string };
  const laptop = { id: "laptop-abcdef12", name: "Mac", platform: "desktop" } as const;

  beforeAll(async () => {
    listener = await register(t, "devices@trusic.test");
    await call(t, "POST", "/api/billing/subscribe", listener.token);
  });

  it("lists the devices keeping downloads, with when they last checked in and how many tracks they have", async () => {
    await sync(listener, { device: device(8), collections: [{ type: "liked" }], trackIds: [track.A!] });
    await sync(listener, { device: laptop, collections: [{ type: "liked" }], trackIds: [track.A!, track.B!] });
    const res = await call<DownloadDevice[]>(t, "GET", "/api/me/download-devices", listener.token);
    expect(res.status).toBe(200);
    // The most recently checked first.
    expect(res.body).toMatchObject([
      { name: "Mac", platform: "desktop", trackCount: 2, removedBy: null },
      { name: "Phone 8", platform: "ios", trackCount: 1, removedBy: null },
    ]);
    expect(Date.parse(res.body[0]!.lastCheckedAt)).toBeGreaterThan(Date.now() - 60_000);
    // Only your own.
    expect((await call<DownloadDevice[]>(t, "GET", "/api/me/download-devices", band.token)).body).toEqual([]);
    expect((await call(t, "GET", "/api/me/download-devices")).status).toBe(401);
  });

  it("removes a device: its downloads go at its next check-in, and its place is free at once", async () => {
    const [mac] = (await call<DownloadDevice[]>(t, "GET", "/api/me/download-devices", listener.token)).body;
    // Someone else can't, and it has to be one of yours.
    expect((await call(t, "DELETE", `/api/me/download-devices/${mac!.id}`, band.token)).status).toBe(404);
    expect((await call(t, "DELETE", `/api/me/download-devices/${mac!.id}`, listener.token)).status).toBe(204);

    const listed = (await call<DownloadDevice[]>(t, "GET", "/api/me/download-devices", listener.token)).body;
    expect(listed.find((d) => d.name === "Mac")).toMatchObject({ removedBy: "listener" });
    expect((await authorize(listener, laptop.id, [track.A!])).status).toBe(409);
    // Four new devices fit without pushing out the phone: the removed Mac doesn't count towards the five.
    for (const n of [11, 12, 13, 14]) await sync(listener, { device: device(n), collections: [{ type: "liked" }] });
    expect((await sync(listener, { device: device(8), collections: [{ type: "liked" }] })).body.status).toBe("ok");

    const told = await sync(listener, { device: laptop, collections: [{ type: "liked" }], trackIds: [track.A!] });
    expect(told.body).toMatchObject({ status: "device_removed", removedBy: "listener", removedTrackIds: [track.A] });
    const after = (await call<DownloadDevice[]>(t, "GET", "/api/me/download-devices", listener.token)).body;
    expect(after.map((d) => d.name)).not.toContain("Mac");
  });

  it("says when the five-device limit pushed a device out instead", async () => {
    // Phone 8 checked in after 11 to 14, so a sixth device pushes out Phone 11.
    await sync(listener, { device: device(15), collections: [{ type: "liked" }] });
    const listed = (await call<DownloadDevice[]>(t, "GET", "/api/me/download-devices", listener.token)).body;
    expect(listed.find((d) => d.name === "Phone 11")).toMatchObject({ removedBy: "limit" });
    const told = await sync(listener, { device: device(11), collections: [{ type: "liked" }] });
    expect(told.body).toMatchObject({ status: "device_removed", removedBy: "limit" });
  });
});
