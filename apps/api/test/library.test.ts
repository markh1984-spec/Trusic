import type {
  Artist,
  ArtistPage,
  HistoryItem,
  LibraryIds,
  LikedTrack,
  PlaylistDetail,
  PlaylistSummary,
  ReleaseDetail,
  ReleaseSummary,
  RightsSummary,
  TrackDetail,
  TrackList,
} from "@trusic/client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plays } from "../src/db/schema";
import { ADMIN_EMAIL, call, createTestApp, declaration, png, register, sendFile, wav, type TestApp } from "./helpers";

let t: TestApp;
let band: { token: string; id: string };
let fan: { token: string; id: string };
let other: { token: string; id: string };
let artist: { id: string; slug: string };
const trackIds: string[] = [];

async function upload(title: string, fields: Record<string, string> = {}) {
  const res = await sendFile(
    t,
    "POST",
    "/api/tracks",
    band.token,
    { artistId: artist.id, title, declaration: JSON.stringify(declaration()), ...fields },
    { name: "audio", filename: `${title}.wav`, data: wav({ seconds: 6, seed: title.length }) },
  );
  expect(res.status).toBe(201);
  return res.body as TrackDetail;
}

beforeAll(async () => {
  t = await createTestApp();
  band = await register(t, "band@trusic.test");
  fan = await register(t, "fan@trusic.test");
  other = await register(t, "other@trusic.test");
  artist = (await call<{ id: string; slug: string }>(t, "POST", "/api/artists", band.token, { name: "Pines" })).body;
  for (const title of ["One", "Two", "Three"]) trackIds.push((await upload(title)).id);
});
afterAll(async () => {
  await t?.close();
});

describe("releases", () => {
  let releaseId: string;

  it("creates a release and sets its tracks in order", async () => {
    expect(
      (await call(t, "POST", "/api/releases", fan.token, { artistId: artist.id, title: "X", type: "ep" })).status,
    ).toBe(403);
    const created = await call<ReleaseDetail>(t, "POST", "/api/releases", band.token, {
      artistId: artist.id,
      title: "Chalk Paths",
      type: "ep",
      releaseDate: "2026-09-01",
    });
    expect(created.status).toBe(201);
    releaseId = created.body.id;

    const set = await call<ReleaseDetail>(t, "PUT", `/api/releases/${releaseId}/tracks`, band.token, {
      trackIds: [trackIds[2], trackIds[0]],
    });
    expect(set.status).toBe(200);
    expect(set.body.tracks.map((x) => [x.title, x.trackNumber])).toEqual([
      ["Three", 1],
      ["One", 2],
    ]);
    expect(set.body.aiLabels).toEqual({ human: 2, ai_assisted: 0, ai_generated: 0 });
    expect(set.body.isOwner).toBe(true);
  });

  it("lists new releases that have tracks", async () => {
    const empty = await call<ReleaseDetail>(t, "POST", "/api/releases", band.token, {
      artistId: artist.id,
      title: "Nothing yet",
      type: "single",
    });
    const latest = await call<ReleaseSummary[]>(t, "GET", "/api/releases");
    expect(latest.body.map((r) => r.title)).toEqual(["Chalk Paths"]);
    await call(t, "DELETE", `/api/releases/${empty.body.id}`, band.token);
  });

  it("appends uploads to a release", async () => {
    const track = await upload("Four", { releaseId });
    expect(track.release).toEqual({ id: releaseId, title: "Chalk Paths" });
    expect(track.trackNumber).toBe(3);
    trackIds.push(track.id);
  });

  it("only lets the owner change it, and only with the artist's own tracks", async () => {
    const otherArtist = (await call<{ id: string }>(t, "POST", "/api/artists", other.token, { name: "Other" })).body;
    const theirs = await sendFile(
      t,
      "POST",
      "/api/tracks",
      other.token,
      { artistId: otherArtist.id, title: "Theirs", declaration: JSON.stringify(declaration()) },
      { name: "audio", filename: "t.wav", data: wav({ seconds: 6 }) },
    );
    const theirTrack = (theirs.body as TrackDetail).id;
    expect(
      (await call(t, "PUT", `/api/releases/${releaseId}/tracks`, band.token, { trackIds: [theirTrack] })).status,
    ).toBe(400);
    expect((await call(t, "PATCH", `/api/releases/${releaseId}`, other.token, { title: "Mine now" })).status).toBe(404);
    const renamed = await call<ReleaseDetail>(t, "PATCH", `/api/releases/${releaseId}`, band.token, {
      title: "Chalk Paths (Deluxe)",
    });
    expect(renamed.body.title).toBe("Chalk Paths (Deluxe)");
  });

  it("stores artwork, checks it really is an image, and serves it", async () => {
    const bad = await sendFile(
      t,
      "PUT",
      `/api/releases/${releaseId}/artwork`,
      band.token,
      {},
      {
        name: "image",
        filename: "cover.png",
        data: Buffer.from("definitely not a png"),
        contentType: "image/png",
      },
    );
    expect(bad.status).toBe(415);

    const res = await sendFile(
      t,
      "PUT",
      `/api/releases/${releaseId}/artwork`,
      band.token,
      {},
      {
        name: "image",
        filename: "cover.png",
        data: png(),
        contentType: "image/png",
      },
    );
    expect(res.status).toBe(200);
    const url = (res.body as ReleaseDetail).artworkUrl!;
    expect(url).toMatch(/^\/api\/images\/[0-9a-f-]{36}\.png$/);

    const image = await t.app.inject({ method: "GET", url });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.headers["cache-control"]).toContain("immutable");

    // Every track on the release now carries the artwork.
    const list = await call<TrackList>(t, "GET", "/api/tracks?q=chalk");
    expect(list.body.tracks.length).toBe(3);
    expect(list.body.tracks.every((x) => x.artworkUrl === url)).toBe(true);

    // Replacing it removes the old file.
    await sendFile(
      t,
      "PUT",
      `/api/releases/${releaseId}/artwork`,
      band.token,
      {},
      {
        name: "image",
        filename: "cover.png",
        data: png(2),
      },
    );
    expect((await t.app.inject({ method: "GET", url })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: "/api/images/../../etc/passwd" })).statusCode).toBe(404);
  });

  it("shows releases, followers and an image on the artist page", async () => {
    const image = await sendFile(
      t,
      "PUT",
      `/api/artists/${artist.id}/image`,
      band.token,
      {},
      {
        name: "image",
        filename: "me.png",
        data: png(3),
      },
    );
    expect((image.body as Artist).imageUrl).toMatch(/^\/api\/images\//);

    await call(t, "PUT", `/api/me/follows/${artist.id}`, fan.token);
    await call(t, "PUT", `/api/me/follows/${artist.id}`, fan.token);
    const page = await call<ArtistPage>(t, "GET", `/api/artists/${artist.slug}`, fan.token);
    expect(page.body).toMatchObject({ followers: 1, isFollowing: true, isOwner: false });
    expect(page.body.releases.map((r) => [r.title, r.type, r.trackCount])).toEqual([["Chalk Paths (Deluxe)", "ep", 3]]);
    expect((await call<ArtistPage>(t, "GET", `/api/artists/${artist.slug}`, band.token)).body.isOwner).toBe(true);
  });

  it("deletes a release but keeps its tracks", async () => {
    expect((await call(t, "DELETE", `/api/releases/${releaseId}`, band.token)).status).toBe(204);
    expect((await call(t, "GET", `/api/releases/${releaseId}`)).status).toBe(404);
    const track = await call<TrackDetail>(t, "GET", `/api/tracks/${trackIds[0]}`);
    expect(track.body).toMatchObject({ release: null, trackNumber: null, artworkUrl: null });
  });
});

describe("songwriting credits", () => {
  it("stores credits, shows the private parts only to the owner, and summarises them for admins", async () => {
    const credits = {
      songwriters: ["Ellie Marsh", "Tom Reid"],
      societyMember: "yes",
      isCover: false,
      isrc: "gb-abc-26-00001",
    };
    const track = await upload("Credited", { credits: JSON.stringify(credits) });
    expect(track.credits).toEqual({ ...credits, isrc: "GBABC2600001" });

    const publicView = await call<TrackDetail>(t, "GET", `/api/tracks/${track.id}`, fan.token);
    expect(publicView.body.credits).toEqual({ songwriters: ["Ellie Marsh", "Tom Reid"], isCover: false });

    const bad = await call(t, "PUT", `/api/tracks/${track.id}/credits`, band.token, { ...credits, isrc: "nope" });
    expect(bad.status).toBe(400);
    const cover = await call<TrackDetail>(t, "PUT", `/api/tracks/${track.id}/credits`, band.token, {
      songwriters: ["Someone Else"],
      societyMember: "unsure",
      isCover: true,
      originalArtist: "The Originals",
    });
    expect(cover.body.credits).toMatchObject({ isCover: true, originalArtist: "The Originals" });
    expect((await call(t, "PUT", `/api/tracks/${track.id}/credits`, fan.token, credits)).status).toBe(404);

    const admin = await register(t, ADMIN_EMAIL);
    const summary = await call<RightsSummary>(t, "GET", "/api/admin/rights-summary", admin.token);
    expect(summary.body).toMatchObject({ covers: 1, societyMember: { unsure: 1 } });
    expect(summary.body.societyMember.notGiven).toBe(summary.body.totalTracks - 1);
    expect((await call(t, "GET", "/api/admin/rights-summary", fan.token)).status).toBe(403);
    await call(t, "DELETE", `/api/tracks/${track.id}`, band.token);
  });
});

describe("library", () => {
  it("likes and unlikes tracks", async () => {
    expect((await call(t, "PUT", `/api/me/likes/${trackIds[0]}`)).status).toBe(401);
    await call(t, "PUT", `/api/me/likes/${trackIds[0]}`, fan.token);
    await call(t, "PUT", `/api/me/likes/${trackIds[1]}`, fan.token);
    await call(t, "PUT", `/api/me/likes/${trackIds[1]}`, fan.token);
    const liked = await call<LikedTrack[]>(t, "GET", "/api/me/likes", fan.token);
    expect(liked.body.map((l) => l.track.title)).toEqual(["Two", "One"]);

    await call(t, "DELETE", `/api/me/likes/${trackIds[1]}`, fan.token);
    const ids = await call<LibraryIds>(t, "GET", "/api/me/library", fan.token);
    expect(ids.body).toEqual({ likedTrackIds: [trackIds[0]], followedArtistIds: [artist.id] });
  });

  it("lists followed artists and unfollows", async () => {
    expect((await call<Artist[]>(t, "GET", "/api/me/follows", fan.token)).body.map((a) => a.name)).toEqual(["Pines"]);
    await call(t, "DELETE", `/api/me/follows/${artist.id}`, fan.token);
    expect((await call<Artist[]>(t, "GET", "/api/me/follows", fan.token)).body).toEqual([]);
  });

  it("shows recently played tracks once each, newest first, and snapshots the AI score", async () => {
    // Only subscribers' plays are recorded.
    await call(t, "POST", "/api/billing/subscribe", fan.token);
    for (const id of [trackIds[0], trackIds[1], trackIds[0]]) {
      await call(t, "POST", "/api/plays", fan.token, { trackId: id, msPlayed: 5000 });
      await new Promise((r) => setTimeout(r, 5));
    }
    const history = await call<HistoryItem[]>(t, "GET", "/api/me/history", fan.token);
    expect(history.body.map((h) => h.track.title)).toEqual(["One", "Two"]);

    const rows = await t.database.db.select({ aiScore: plays.aiScore }).from(plays).where(eq(plays.userId, fan.id));
    expect(rows.map((r) => r.aiScore)).toEqual([0, 0, 0]);
  });
});

describe("playlists", () => {
  let playlistId: string;

  it("creates a playlist and adds tracks, duplicates allowed", async () => {
    const created = await call<PlaylistDetail>(t, "POST", "/api/playlists", fan.token, { name: "Road trip" });
    expect(created.status).toBe(201);
    playlistId = created.body.id;
    const added = await call<PlaylistDetail>(t, "POST", `/api/playlists/${playlistId}/entries`, fan.token, {
      trackIds: [trackIds[0], trackIds[1], trackIds[0]],
    });
    expect(added.body.entries.map((e) => e.track.title)).toEqual(["One", "Two", "One"]);
    expect(added.body.trackCount).toBe(3);
    expect(added.body.durationMs).toBe(18_000);

    const mine = await call<PlaylistSummary[]>(t, "GET", "/api/me/playlists", fan.token);
    expect(mine.body.map((p) => [p.name, p.trackCount])).toEqual([["Road trip", 3]]);
  });

  it("reorders and removes entries", async () => {
    const before = (await call<PlaylistDetail>(t, "GET", `/api/playlists/${playlistId}`, fan.token)).body;
    const ids = before.entries.map((e) => e.entryId);
    expect(
      (await call(t, "PUT", `/api/playlists/${playlistId}/order`, fan.token, { entryIds: ids.slice(1) })).status,
    ).toBe(400);
    const reordered = await call<PlaylistDetail>(t, "PUT", `/api/playlists/${playlistId}/order`, fan.token, {
      entryIds: [ids[1], ids[2], ids[0]],
    });
    expect(reordered.body.entries.map((e) => e.entryId)).toEqual([ids[1], ids[2], ids[0]]);

    const removed = await call<PlaylistDetail>(
      t,
      "DELETE",
      `/api/playlists/${playlistId}/entries/${ids[2]}`,
      fan.token,
    );
    expect(removed.body.entries.map((e) => e.track.title)).toEqual(["Two", "One"]);
  });

  it("keeps private playlists private and only lets the owner edit", async () => {
    expect((await call(t, "GET", `/api/playlists/${playlistId}`)).status).toBe(200);
    await call(t, "PATCH", `/api/playlists/${playlistId}`, fan.token, { isPublic: false, name: "Secret" });
    expect((await call(t, "GET", `/api/playlists/${playlistId}`)).status).toBe(404);
    expect((await call(t, "GET", `/api/playlists/${playlistId}`, other.token)).status).toBe(404);
    expect((await call<PlaylistDetail>(t, "GET", `/api/playlists/${playlistId}`, fan.token)).body.name).toBe("Secret");
    expect(
      (await call(t, "POST", `/api/playlists/${playlistId}/entries`, other.token, { trackIds: [trackIds[0]] })).status,
    ).toBe(404);
  });

  it("hides removed tracks from playlists and likes", async () => {
    await call(t, "DELETE", `/api/tracks/${trackIds[0]}`, band.token);
    const playlist = await call<PlaylistDetail>(t, "GET", `/api/playlists/${playlistId}`, fan.token);
    expect(playlist.body.entries.map((e) => e.track.title)).toEqual(["Two"]);
    expect((await call<LikedTrack[]>(t, "GET", "/api/me/likes", fan.token)).body).toEqual([]);

    // Reordering only needs the visible entries.
    const reordered = await call(t, "PUT", `/api/playlists/${playlistId}/order`, fan.token, {
      entryIds: playlist.body.entries.map((e) => e.entryId),
    });
    expect(reordered.status).toBe(200);
  });

  it("deletes a playlist", async () => {
    expect((await call(t, "DELETE", `/api/playlists/${playlistId}`, other.token)).status).toBe(404);
    expect((await call(t, "DELETE", `/api/playlists/${playlistId}`, fan.token)).status).toBe(204);
    expect((await call<PlaylistSummary[]>(t, "GET", "/api/me/playlists", fan.token)).body).toEqual([]);
  });
});
