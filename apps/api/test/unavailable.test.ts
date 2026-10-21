import type {
  AdminReport,
  ArtistPage,
  MyTakedown,
  PlaylistDetail,
  ReleaseDetail,
  ReportReceipt,
  TrackDetail,
} from "@trusic/client";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mediaJobs, tracks } from "../src/db/schema";
import { ADMIN_EMAIL, call, createTestApp, declaration, png, register, sendFile, wav, type TestApp } from "./helpers";

let t: TestApp;
let admin: { token: string; id: string };
let band: { token: string; id: string };
let fan: { token: string; id: string };
let artistId = "";

async function upload(artist: string, title: string, token = band.token) {
  const res = await sendFile(
    t,
    "POST",
    "/api/tracks",
    token,
    { artistId: artist, title, declaration: JSON.stringify(declaration()) },
    { name: "audio", filename: `${title}.wav`, data: wav({ seconds: 35, seed: title.length }) },
  );
  return res as { status: number; body: TrackDetail & { error?: string } };
}

async function newRelease(title: string, artist = artistId, token = band.token) {
  const release = (
    await call<ReleaseDetail>(t, "POST", "/api/releases", token, { artistId: artist, title, type: "single" })
  ).body;
  const art = await sendFile(
    t,
    "PUT",
    `/api/releases/${release.id}/artwork`,
    token,
    {},
    {
      name: "image",
      filename: "cover.png",
      data: png(title.length),
      contentType: "image/png",
    },
  );
  return { id: release.id, artworkUrl: (art.body as ReleaseDetail).artworkUrl! };
}

/** Send a report, each from a different address so the per-address limit on reports doesn't get in the way. */
let sent = 0;
async function report(targetType: string, targetId: string, reason = "offensive") {
  sent += 1;
  const res = await t.app.inject({
    method: "POST",
    url: "/api/reports",
    headers: { "x-forwarded-for": `10.9.0.${sent}`, authorization: `Bearer ${fan.token}` },
    payload: {
      targetType,
      targetId,
      reason,
      details: "This shouldn't be on Trusic at all.",
      ...(reason === "copyright"
        ? {
            copyright: {
              role: "owner",
              claimantName: "Rita Rights",
              address: "1 High Street, Leeds LS1 1AA",
              work: '"The Original" by Rita Rights, released 2020.',
              goodFaith: true,
              accurate: true,
              signature: "Rita Rights",
            },
          }
        : {}),
    },
  });
  return (res.json() as ReportReceipt).id;
}

const act = (reportId: string, action: "take-down" | "restore", note: string) =>
  call<AdminReport>(t, "POST", `/api/admin/reports/${reportId}/${action}`, admin.token, { note });

/** Fetch an image as someone (or no one), as a browser would. */
const image = (url: string, token?: string) =>
  t.app.inject({ method: "GET", url, headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeAll(async () => {
  t = await createTestApp();
  admin = await register(t, ADMIN_EMAIL);
  band = await register(t, "band@trusic.test");
  fan = await register(t, "fan@trusic.test");
  artistId = (await call<{ id: string }>(t, "POST", "/api/artists", band.token, { name: "Picture Band" })).body.id;
});
afterAll(async () => {
  await t?.close();
});

describe("artwork of things that aren't public", () => {
  it("serves a taken-down release's artwork only to its owner and admins, and never lets it be kept", async () => {
    const release = await newRelease("Cover Story");
    const before = await image(release.artworkUrl);
    expect(before.statusCode).toBe(200);
    expect(before.headers["cache-control"]).toBe("public, max-age=3600");

    const reportId = await report("release", release.id);
    await act(reportId, "take-down", "The cover breaks our rules.");

    const anyone = await image(release.artworkUrl);
    expect(anyone.statusCode).toBe(404);
    expect(anyone.headers["cache-control"]).toBe("no-store");
    expect((await image(`${release.artworkUrl}?size=300`, fan.token)).statusCode).toBe(404);
    // A browser that kept the old copy and checks again is told it's gone, not "unchanged".
    const revalidate = await t.app.inject({
      method: "GET",
      url: release.artworkUrl,
      headers: { "if-none-match": before.headers.etag as string },
    });
    expect(revalidate.statusCode).toBe(404);

    for (const who of [band.token, admin.token]) {
      const res = await image(release.artworkUrl, who);
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.headers.vary).toContain("authorization");
    }

    // Put back: public again.
    await act(reportId, "restore", "On a second look it's fine.");
    expect((await image(release.artworkUrl)).statusCode).toBe(200);
  });

  it("hides artwork taken down on its own, and a taken-down artist's photo", async () => {
    const release = await newRelease("Loud Cover");
    const name = release.artworkUrl.split("/").pop()!;
    const reportId = await report("artwork", name);
    await act(reportId, "take-down", "The cover is graphic.");
    expect((await image(release.artworkUrl)).statusCode).toBe(404);
    expect((await image(release.artworkUrl, band.token)).statusCode).toBe(200);
    await act(reportId, "restore", "It's fine after all.");
    expect((await image(release.artworkUrl)).statusCode).toBe(200);

    const other = await register(t, "imposter@trusic.test");
    const fake = (await call<{ id: string }>(t, "POST", "/api/artists", other.token, { name: "Not The Band" })).body;
    const photo = await sendFile(
      t,
      "PUT",
      `/api/artists/${fake.id}/image`,
      other.token,
      {},
      {
        name: "image",
        filename: "me.png",
        data: png(9),
        contentType: "image/png",
      },
    );
    const photoUrl = (photo.body as { imageUrl: string }).imageUrl;
    expect((await image(photoUrl)).statusCode).toBe(200);
    await act(await report("artist", fake.id, "impersonation"), "take-down", "Pretending to be another band.");
    expect((await image(photoUrl)).statusCode).toBe(404);
    expect((await image(photoUrl, other.token)).statusCode).toBe(200);
    expect((await image(photoUrl, admin.token)).statusCode).toBe(200);
  });

  it("keeps a release's artwork public when only one of its tracks is taken down", async () => {
    const release = await newRelease("Mostly Fine");
    const one = (await upload(artistId, "Fine One")).body.id;
    await call(t, "PUT", `/api/releases/${release.id}/tracks`, band.token, { trackIds: [one] });
    await act(await report("track", one), "take-down", "The title is a slur.");
    // The release still shows it, so it stays public.
    expect((await call(t, "GET", `/api/releases/${release.id}`)).status).toBe(200);
    expect((await image(release.artworkUrl)).statusCode).toBe(200);
  });

  it("stops serving a deleted account's pictures, even to people who had the address", async () => {
    const leaver = await register(t, "leaver@trusic.test");
    const own = (await call<{ id: string }>(t, "POST", "/api/artists", leaver.token, { name: "Leavers" })).body;
    const release = await newRelease("Goodbye", own.id, leaver.token);
    expect((await image(release.artworkUrl)).statusCode).toBe(200);
    await call(t, "POST", "/api/me/delete", leaver.token, { password: "correct horse battery", confirm: "DELETE" });
    expect((await image(release.artworkUrl)).statusCode).toBe(404);
    expect((await image(release.artworkUrl, admin.token)).statusCode).toBe(404);
  });

  it("keeps link previews in step: no share picture or embed details for taken-down things", async () => {
    const release = await newRelease("Shared Single");
    const share = () => image(`/api/share/release/${release.id}/image.jpg`);
    expect((await share()).statusCode).toBe(200);
    await act(await report("release", release.id), "take-down", "Not allowed.");
    expect((await share()).statusCode).toBe(404);
    const oembed = await call(
      t,
      "GET",
      `/api/oembed?url=${encodeURIComponent(`https://trusic.test/release/${release.id}`)}`,
    );
    expect(oembed.status).toBe(404);
  });
});

describe("nothing new on a taken-down artist", () => {
  it("refuses uploads and new releases until the artist is put back", async () => {
    const owner = await register(t, "downed@trusic.test");
    const own = (await call<{ id: string }>(t, "POST", "/api/artists", owner.token, { name: "Downed" })).body;
    const reportId = await report("artist", own.id, "impersonation");
    await act(reportId, "take-down", "Pretending to be someone else.");

    const refused = await upload(own.id, "Sneaky", owner.token);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/taken down/);
    const release = await call<{ error: string }>(t, "POST", "/api/releases", owner.token, {
      artistId: own.id,
      title: "Sneaky Album",
      type: "album",
    });
    expect(release.status).toBe(403);
    // The owner can still see it, and is told it's down.
    expect((await call<ArtistPage>(t, "GET", "/api/artists/downed", owner.token)).body.takenDown).toBe(true);

    await act(reportId, "restore", "They are who they say.");
    expect((await upload(own.id, "Allowed", owner.token)).status).toBe(201);
    expect((await call<ArtistPage>(t, "GET", "/api/artists/downed")).body.takenDown).toBe(false);
  });

  it("tells a playlist's owner it's been taken down", async () => {
    const playlist = (await call<PlaylistDetail>(t, "POST", "/api/playlists", band.token, { name: "Rude Name" })).body;
    expect(playlist.takenDown).toBe(false);
    await act(await report("playlist", playlist.id), "take-down", "The name is offensive.");
    expect((await call<PlaylistDetail>(t, "GET", `/api/playlists/${playlist.id}`, band.token)).body.takenDown).toBe(
      true,
    );
  });
});

describe("restoring a track taken down while it was being converted", () => {
  /**
   * An artist with a track whose upload is still being converted, as if just uploaded: "processing", with its job
   * waiting. Unconverted tracks can't be reported themselves, but they come down with their artist.
   */
  async function artistWithUnconvertedTrack(name: string) {
    const owner = await register(t, `${name.toLowerCase()}@trusic.test`);
    const artist = (await call<{ id: string }>(t, "POST", "/api/artists", owner.token, { name })).body;
    const id = (await upload(artist.id, `${name} Song`, owner.token)).body.id;
    const { db } = t.database;
    const [row] = await db.select().from(tracks).where(eq(tracks.id, id));
    await db.update(tracks).set({ status: "processing" }).where(eq(tracks.id, id));
    await db.insert(mediaJobs).values({ kind: "audio", sourceKey: row!.audioKey, trackId: id, status: "pending" });
    const reportId = await report("artist", artist.id, "impersonation");
    await act(reportId, "take-down", "Pretending to be another band.");
    expect(await statusOf(id)).toBe("taken_down");
    return { id, reportId, owner };
  }
  const statusOf = async (id: string) =>
    (await t.database.db.select({ status: tracks.status }).from(tracks).where(eq(tracks.id, id)))[0]!.status;

  it("goes back to processing, not live on the upload itself", async () => {
    const { id, reportId, owner } = await artistWithUnconvertedTrack("Converting");
    await act(reportId, "restore", "They are who they say.");
    expect(await statusOf(id)).toBe("processing");
    expect((await call(t, "GET", `/api/tracks/${id}`)).status).toBe(404);
    expect((await call(t, "GET", `/api/tracks/${id}/stream`, owner.token)).status).toBe(404);
    expect((await call<TrackDetail>(t, "GET", `/api/tracks/${id}`, owner.token)).body.processing).toBe("processing");
  });

  it("goes back to failed if converting it failed while it was down", async () => {
    const { id, reportId } = await artistWithUnconvertedTrack("Failing");
    await t.database.db.update(mediaJobs).set({ status: "failed" }).where(eq(mediaJobs.trackId, id));
    await act(reportId, "restore", "They are who they say.");
    expect(await statusOf(id)).toBe("failed");
  });

  it("goes live if converting it finished while it was down", async () => {
    const { id, reportId } = await artistWithUnconvertedTrack("Finished");
    await t.database.db
      .update(tracks)
      .set({ audioProcessedAt: sql`now()` })
      .where(eq(tracks.id, id));
    await t.database.db.update(mediaJobs).set({ status: "done" }).where(eq(mediaJobs.trackId, id));
    await act(reportId, "restore", "They are who they say.");
    expect(await statusOf(id)).toBe("live");
  });
});

describe("what an uploader is told about a track that isn't live", () => {
  it("gives the takedown's reason, and a counter-notice while one can be sent", async () => {
    const id = (await upload(artistId, "Disputed")).body.id;
    const reportId = await report("track", id, "copyright");
    await act(reportId, "take-down", "It copies the claimant's recording.");

    expect((await call(t, "GET", `/api/tracks/${id}`, fan.token)).status).toBe(404);
    const own = (await call<TrackDetail>(t, "GET", `/api/tracks/${id}`, band.token)).body;
    expect(own.unavailable).toEqual({
      status: "taken_down",
      failure: null,
      takedown: {
        reportId,
        reference: reportId.slice(0, 8).toUpperCase(),
        reason: "copyright",
        note: "It copies the claimant's recording.",
        status: "taken_down",
        canCounterNotice: true,
      },
    });
    // Admins see why too, but the counter-notice is the uploader's to send.
    const asAdmin = (await call<TrackDetail>(t, "GET", `/api/tracks/${id}`, admin.token)).body;
    expect(asAdmin.unavailable?.takedown?.canCounterNotice).toBe(false);

    await call<MyTakedown>(t, "POST", `/api/me/takedowns/${reportId}/counter-notice`, band.token, {
      name: "Band Leader",
      explanation: "We wrote and recorded this ourselves in 2024.",
      goodFaith: true,
      consentToShare: true,
    });
    const after = (await call<TrackDetail>(t, "GET", `/api/tracks/${id}`, band.token)).body;
    expect(after.unavailable?.takedown).toMatchObject({ status: "counter_notice", canCounterNotice: false });
  });

  it("finds the takedown when the track came down with its release", async () => {
    const release = await newRelease("Whole Single");
    const id = (await upload(artistId, "On The Single")).body.id;
    await call(t, "PUT", `/api/releases/${release.id}/tracks`, band.token, { trackIds: [id] });
    const reportId = await report("release", release.id);
    await act(reportId, "take-down", "The single's title is a slur.");
    const own = (await call<TrackDetail>(t, "GET", `/api/tracks/${id}`, band.token)).body;
    expect(own.unavailable?.takedown).toMatchObject({ reportId, reason: "offensive" });
  });

  it("says why converting failed, in plain words", async () => {
    const id = (await upload(artistId, "Mangled")).body.id;
    const [row] = await t.database.db.select().from(tracks).where(eq(tracks.id, id));
    await t.database.db.update(tracks).set({ status: "failed" }).where(eq(tracks.id, id));
    await t.database.db.insert(mediaJobs).values({
      kind: "audio",
      sourceKey: row!.audioKey,
      trackId: id,
      status: "failed",
      error: "ffmpeg failed (exit 1): mangled.wav: Invalid data found when processing input",
    });
    const own = (await call<TrackDetail>(t, "GET", `/api/tracks/${id}`, band.token)).body;
    expect(own.processing).toBe("failed");
    expect(own.unavailable).toEqual({
      status: "failed",
      failure: { reason: "The file looks damaged, or it's in a form we can't read.", canRetry: true },
      takedown: null,
    });
    expect((await call(t, "GET", `/api/tracks/${id}`, fan.token)).status).toBe(404);
  });

  it("is nothing for a live track", async () => {
    const id = (await upload(artistId, "All Good")).body.id;
    expect((await call<TrackDetail>(t, "GET", `/api/tracks/${id}`, band.token)).body.unavailable).toBeNull();
    expect((await call<TrackDetail>(t, "GET", `/api/tracks/${id}`)).body.unavailable).toBeNull();
  });
});
