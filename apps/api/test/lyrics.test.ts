import {
  activeLyricIndex,
  formatLrcTime,
  looksSynced,
  parseLyrics,
  toLrc,
  type LyricsTrack,
  type TrackDetail,
  type TrackLyrics,
} from "@trusic/client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trackLyrics } from "../src/db/schema";
import { call, createTestApp, declaration, register, sendFile, wav, type TestApp } from "./helpers";

describe("parsing lyrics", () => {
  it("tidies plain lyrics, keeping one gap between verses", () => {
    const { lines, error } = parseLyrics("plain", "\n\n  First line  \nSecond line\n\n\n\nChorus\n\n");
    expect(error).toBeNull();
    expect(lines.map((l) => l.text)).toEqual(["First line", "Second line", "", "Chorus"]);
    expect(lines.every((l) => l.timeMs === null)).toBe(true);
    expect(parseLyrics("plain", " \n ").error).toBe("Type or paste the lyrics first.");
  });

  it("reads LRC: several times per line, offsets, word timings and information tags", () => {
    const lrc = [
      "[ar:The Hollow Pines]",
      "[offset:+500]",
      "[00:12.00]Down the chalk paths",
      "[00:20.5][01:02.25]<00:20.50>We <00:21.00>sing",
      "[00:30.00]",
      "[1:05]Last line",
    ].join("\r\n");
    const { lines, error } = parseLyrics("synced", lrc);
    expect(error).toBeNull();
    expect(lines).toEqual([
      { timeMs: 11_500, text: "Down the chalk paths" },
      { timeMs: 20_000, text: "We sing" },
      { timeMs: 29_500, text: "" },
      { timeMs: 61_750, text: "We sing" },
      { timeMs: 64_500, text: "Last line" },
    ]);
    expect(looksSynced(lrc)).toBe(true);
    expect(looksSynced("Just words\nand more")).toBe(false);
  });

  it("explains what's wrong with synced lyrics", () => {
    expect(parseLyrics("synced", "[00:01.00]One\nTwo").error).toMatch(/^Line 2 has no time/);
    expect(parseLyrics("synced", "[00:75.00]One").error).toMatch(/^Line 1 has a time that can't be right/);
    expect(parseLyrics("synced", "[ar:Someone]").error).toMatch(/at least one line with a time/);
    expect(parseLyrics("plain", "x".repeat(20_001)).error).toMatch(/up to 20,000 characters/);
  });

  it("finds the line being sung, and writes LRC back out", () => {
    const { lines } = parseLyrics("synced", "[00:05.00]A\n[00:10.00]B\n[00:15.00]C");
    expect(activeLyricIndex(lines, 0)).toBe(-1);
    expect(activeLyricIndex(lines, 5_000)).toBe(0);
    expect(activeLyricIndex(lines, 14_999)).toBe(1);
    expect(activeLyricIndex(lines, 99_000)).toBe(2);
    expect(activeLyricIndex(parseLyrics("plain", "A\nB").lines, 5_000)).toBe(-1);
    expect(formatLrcTime(83_456)).toBe("01:23.46");
    expect(toLrc(lines)).toBe("[00:05.00]A\n[00:10.00]B\n[00:15.00]C");
  });
});

describe("lyrics", () => {
  let t: TestApp;
  let band: { token: string; id: string };
  let bassist: { token: string; id: string };
  let stranger: { token: string; id: string };
  let trackId: string;
  const url = () => `/api/tracks/${trackId}/lyrics`;

  beforeAll(async () => {
    t = await createTestApp();
    band = await register(t, "band@trusic.test");
    bassist = await register(t, "bass@trusic.test");
    stranger = await register(t, "stranger@trusic.test");
    const artist = (await call<{ id: string }>(t, "POST", "/api/artists", band.token, { name: "Pines" })).body;
    const upload = await sendFile(
      t,
      "POST",
      "/api/tracks",
      band.token,
      { artistId: artist.id, title: "Chalk Paths", declaration: JSON.stringify(declaration()) },
      // 40 seconds long.
      { name: "audio", filename: "chalk.wav", data: wav() },
    );
    trackId = (upload.body as TrackDetail).id;
  });
  afterAll(async () => {
    await t?.close();
  });

  it("starts empty, and only the uploader can edit", async () => {
    const visitor = await call<TrackLyrics>(t, "GET", url());
    expect(visitor.status).toBe(200);
    expect(visitor.body).toMatchObject({ format: null, lines: [], canEdit: false, hidden: null });
    expect((await call<TrackLyrics>(t, "GET", url(), band.token)).body.canEdit).toBe(true);
    expect((await call<TrackLyrics>(t, "GET", url(), bassist.token)).body.canEdit).toBe(false);

    const refused = await call<{ error: string }>(t, "PUT", url(), stranger.token, { format: "plain", text: "Hi" });
    expect(refused.status).toBe(403);
    expect((await call(t, "PUT", url(), undefined, { format: "plain", text: "Hi" })).status).toBe(401);
  });

  it("saves plain lyrics and shows them to everyone", async () => {
    const saved = await call<TrackLyrics>(t, "PUT", url(), band.token, {
      format: "plain",
      text: "Down the chalk paths\n\nWe sing",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.source).toBe("Down the chalk paths\n\nWe sing");
    const visitor = await call<TrackLyrics>(t, "GET", url());
    expect(visitor.body.format).toBe("plain");
    expect(visitor.body.lines.map((l) => l.text)).toEqual(["Down the chalk paths", "", "We sing"]);
    // Only editors get the raw text back.
    expect(visitor.body.source).toBeNull();
  });

  it("checks synced lyrics, including against the track's length", async () => {
    const untimed = await call<{ error: string }>(t, "PUT", url(), band.token, {
      format: "synced",
      text: "[00:01.00]One\nTwo",
    });
    expect(untimed.status).toBe(400);
    expect(untimed.body.error).toMatch(/Line 2 has no time/);

    const tooLate = await call<{ error: string }>(t, "PUT", url(), band.token, {
      format: "synced",
      text: "[00:01.00]One\n[02:00.00]Two",
    });
    expect(tooLate.status).toBe(400);
    expect(tooLate.body.error).toMatch(/after the end of the track/);

    const ok = await call<TrackLyrics>(t, "PUT", url(), band.token, {
      format: "synced",
      text: "[00:01.00]One\n[00:20.00]Two",
    });
    expect(ok.body.lines).toEqual([
      { timeMs: 1000, text: "One" },
      { timeMs: 20_000, text: "Two" },
    ]);
  });

  it("lets everyone in the band split edit, and lists their tracks", async () => {
    expect((await call(t, "PUT", url(), bassist.token, { format: "plain", text: "Mine" })).status).toBe(403);
    await call(t, "PUT", `/api/tracks/${trackId}/splits`, band.token, {
      splits: [
        { email: "band@trusic.test", shareBps: 6000 },
        { email: "bass@trusic.test", shareBps: 4000 },
      ],
    });
    const edited = await call<TrackLyrics>(t, "PUT", url(), bassist.token, {
      format: "synced",
      text: "[00:02.00]From the bass player",
    });
    expect(edited.status).toBe(200);

    const theirs = await call<LyricsTrack[]>(t, "GET", "/api/me/lyrics", bassist.token);
    expect(theirs.body).toHaveLength(1);
    expect(theirs.body[0]).toMatchObject({ format: "synced", role: "split", isCover: false, instrumental: false });
    expect(theirs.body[0]!.track.id).toBe(trackId);
    expect((await call<LyricsTrack[]>(t, "GET", "/api/me/lyrics", band.token)).body[0]!.role).toBe("uploader");
    expect((await call<LyricsTrack[]>(t, "GET", "/api/me/lyrics", stranger.token)).body).toEqual([]);
  });

  it("hides lyrics on covers, and won't take new ones", async () => {
    await call(t, "PUT", `/api/tracks/${trackId}/credits`, band.token, {
      songwriters: ["Someone Famous"],
      societyMember: "yes",
      isCover: true,
      originalArtist: "Someone Famous",
    });
    const visitor = await call<TrackLyrics>(t, "GET", url());
    expect(visitor.body).toMatchObject({ format: null, lines: [], hidden: "cover" });
    // The band still sees what was there, so they can remove it.
    const editor = await call<TrackLyrics>(t, "GET", url(), band.token);
    expect(editor.body).toMatchObject({ format: "synced", hidden: "cover", canEdit: true });

    const refused = await call<{ error: string }>(t, "PUT", url(), band.token, { format: "plain", text: "Words" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/can't be shown for covers/);
    expect((await call<LyricsTrack[]>(t, "GET", "/api/me/lyrics", band.token)).body[0]!.isCover).toBe(true);
  });

  it("deletes lyrics, and hides them with the track", async () => {
    expect((await call(t, "DELETE", url(), stranger.token)).status).toBe(403);
    expect((await call(t, "DELETE", url(), band.token)).status).toBe(204);
    expect((await call<TrackLyrics>(t, "GET", url(), band.token)).body.format).toBeNull();

    await call(t, "DELETE", `/api/tracks/${trackId}`, band.token);
    expect((await call(t, "GET", url())).status).toBe(404);
    expect((await call(t, "PUT", url(), band.token, { format: "plain", text: "x" })).status).toBe(404);
  });

  it("are in the account's data download, and deleted with the account", async () => {
    const singer = await register(t, "singer@trusic.test");
    const artist = (await call<{ id: string }>(t, "POST", "/api/artists", singer.token, { name: "Singer" })).body;
    const upload = await sendFile(
      t,
      "POST",
      "/api/tracks",
      singer.token,
      { artistId: artist.id, title: "Mine", declaration: JSON.stringify(declaration()) },
      { name: "audio", filename: "mine.wav", data: wav({ seconds: 6 }) },
    );
    const id = (upload.body as TrackDetail).id;
    await call(t, "PUT", `/api/tracks/${id}/lyrics`, singer.token, { format: "plain", text: "My own words" });

    const exported = await t.app.inject({
      method: "GET",
      url: "/api/me/export",
      headers: { authorization: `Bearer ${singer.token}` },
    });
    const lyrics = exported.json<{ lyrics: { trackId: string; text: string }[] }>().lyrics;
    expect(lyrics).toEqual([expect.objectContaining({ trackId: id, text: "My own words" })]);

    const deleted = await call(t, "POST", "/api/me/delete", singer.token, {
      password: "correct horse battery",
      confirm: "DELETE",
    });
    expect(deleted.status).toBe(204);
    const left = await t.database.db.select().from(trackLyrics).where(eq(trackLyrics.trackId, id));
    expect(left).toEqual([]);
  });
});
