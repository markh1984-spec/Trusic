import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Artist, ReleaseDetail, StreamUrl, TrackDetail, TrackList, UploadInProgress } from "@trusic/client";
import { eq, sql } from "drizzle-orm";
import { parseBuffer } from "music-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mediaJobs, tracks } from "../src/db/schema";
import { findFfmpeg } from "../src/media/ffmpeg";
import { jpegOrientation } from "../src/media/images";
import { MediaProcessor } from "../src/media/processor";
import { synthPng, synthWav } from "../src/synth";
import { call, createTestApp, declaration, register, sendFile, type TestApp } from "./helpers";

const hasFfmpeg = (await findFfmpeg("ffmpeg")) !== null;
if (!hasFfmpeg) console.warn("ffmpeg isn't installed, so the media processing tests are skipped.");

let scratch = "";
beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "trusic-media-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** Make a test file with ffmpeg's own generators (lavfi), e.g. loud pink noise or a quiet tone. */
async function generate(name: string, args: string[]): Promise<Buffer> {
  const out = path.join(scratch, name);
  const run = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args, out]);
  if (run.status !== 0) throw new Error(`ffmpeg: ${run.stderr}`);
  return readFile(out);
}

/** Integrated loudness (LUFS) and true peak (dBTP) of a file, measured independently of the app's own code. */
async function measure(data: Buffer) {
  const file = path.join(scratch, `measure-${Math.random()}.m4a`);
  await writeFile(file, data);
  const run = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"],
    {
      encoding: "utf8",
    },
  );
  const summary = run.stderr.slice(run.stderr.lastIndexOf("Summary:"));
  return {
    lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]),
    peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]),
  };
}

/** Width and height of a WebP image. */
function webpSize(data: Buffer): { width: number; height: number } {
  const chunk = data.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
  throw new Error(`not a WebP image (${chunk})`);
}

/** Decode an image to RGB with ffmpeg and return the colour at (x, y). */
async function pixel(data: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const file = path.join(scratch, `pixel-${Math.random()}.webp`);
  await writeFile(file, data);
  const { width } = webpSize(data);
  const run = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const at = (y * width + x) * 3;
  return [run.stdout[at]!, run.stdout[at + 1]!, run.stdout[at + 2]!];
}

async function upload(t: TestApp, token: string, artistId: string, title: string, audio: Buffer) {
  return sendFile(
    t,
    "POST",
    "/api/tracks",
    token,
    { artistId, title, declaration: JSON.stringify(declaration()) },
    { name: "audio", filename: `${title}.wav`, data: audio },
  ) as Promise<{ status: number; body: TrackDetail }>;
}

async function fetchBytes(t: TestApp, url: string, headers: Record<string, string> = {}) {
  const res = await t.app.inject({ method: "GET", url, headers });
  return { status: res.statusCode, headers: res.headers, body: res.rawPayload };
}

describe.skipIf(!hasFfmpeg)("audio processing", () => {
  let t: TestApp;
  let band: { token: string; id: string };
  let artistId = "";
  const ids: Record<string, string> = {};
  // 45 seconds of the demo synth at CD sample rate: about 4 MB of WAV.
  const wav = synthWav({ seconds: 45, sampleRate: 44_100, seed: 5 });

  beforeAll(async () => {
    t = await createTestApp({ media: true });
    band = await register(t, "band@trusic.test");
    artistId = (await call<Artist>(t, "POST", "/api/artists", band.token, { name: "Processing Band" })).body.id;
  });
  afterAll(async () => {
    await t?.close();
  });

  it("keeps a new upload out of sight while it's processed, then makes it live", async () => {
    // Hold the work back, so we can see the track while it waits.
    await t.media.stop();
    const res = await upload(t, band.token, artistId, "Slow Burner", wav);
    expect(res.status).toBe(201);
    expect(res.body.processing).toBe("processing");
    ids.track = res.body.id;

    expect((await call<TrackList>(t, "GET", "/api/tracks")).body.total).toBe(0);
    expect((await call(t, "GET", `/api/tracks/${ids.track}`)).status).toBe(404);
    expect((await call(t, "GET", `/api/tracks/${ids.track}/stream`, band.token)).status).toBe(404);
    const uploads = await call<UploadInProgress[]>(t, "GET", "/api/me/uploads", band.token);
    expect(uploads.body).toMatchObject([{ track: { id: ids.track, title: "Slow Burner" }, status: "processing" }]);

    // A fresh processor picks up the waiting job, as after a restart.
    t.media = await MediaProcessor.create({ db: t.database.db, storage: t.storage, ffmpegPath: "ffmpeg" });
    t.media.start();
    await t.media.idle();

    expect((await call<TrackDetail>(t, "GET", `/api/tracks/${ids.track}`)).body.processing).toBeNull();
    expect((await call<TrackList>(t, "GET", "/api/tracks")).body.total).toBe(1);
    expect((await call<UploadInProgress[]>(t, "GET", "/api/me/uploads", band.token)).body).toEqual([]);
  });

  it("streams AAC that's much smaller than the upload, with seeking", async () => {
    const signed = await call<StreamUrl>(t, "GET", `/api/tracks/${ids.track}/stream`, band.token);
    const full = await fetchBytes(t, signed.body.url);
    expect(full.status).toBe(200);
    expect(full.headers["content-type"]).toBe("audio/mp4");
    expect(full.body.toString("ascii", 4, 8)).toBe("ftyp");
    expect(full.body.length).toBeLessThan(wav.length / 3);
    const meta = await parseBuffer(full.body, { mimeType: "audio/mp4" }, { duration: true });
    expect(meta.format.codec).toMatch(/AAC/i);
    expect(meta.format.numberOfChannels).toBe(2);
    expect(meta.format.duration).toBeCloseTo(45, 0);

    const part = await fetchBytes(t, signed.body.url, { range: "bytes=1000-1999" });
    expect(part.status).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 1000-1999/${full.body.length}`);
    expect(part.body.equals(full.body.subarray(1000, 2000))).toBe(true);
  });

  it("keeps the upload itself privately, for re-encoding later", async () => {
    const [row] = await t.database.db.select().from(tracks).where(eq(tracks.id, ids.track!));
    expect(row!.originalAudioKey).toBe(`originals/${ids.track}.wav`);
    expect(row!.audioKey).toBe(`tracks/${ids.track}.m4a`);
    expect(await t.storage.size(row!.originalAudioKey!)).toBe(wav.length);
  });

  it("gives non-subscribers a separate 30-second preview file that can't become the full track", async () => {
    const fan = await register(t, "fan@trusic.test");
    const signed = await call<StreamUrl>(t, "GET", `/api/tracks/${ids.track}/stream`, fan.token);
    expect(signed.body).toMatchObject({ preview: true, previewMs: 30_000 });
    const preview = await fetchBytes(t, signed.body.url);
    expect(preview.status).toBe(200);
    expect(preview.headers["content-type"]).toBe("audio/mp4");
    const meta = await parseBuffer(preview.body, { mimeType: "audio/mp4" }, { duration: true });
    expect(meta.format.duration).toBeCloseTo(30, 0);

    const beyond = await fetchBytes(t, signed.body.url, { range: `bytes=${preview.body.length}-` });
    expect(beyond.status).toBe(416);
    expect((await fetchBytes(t, signed.body.url.replace("&preview=1", ""))).status).toBe(403);
  });

  it("brings loud and quiet tracks to about −14 LUFS without clipping", async () => {
    const loud = await generate("loud.wav", [
      // A hot, clipped master.
      ...["-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.9:duration=35:sample_rate=48000"],
      ...["-af", "volume=10dB", "-ac", "2", "-c:a", "pcm_s16le"],
    ]);
    const quiet = await generate("quiet.wav", [
      ...["-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100:duration=35", "-af", "volume=-10dB"],
      ...["-c:a", "pcm_s16le"],
    ]);
    const before = { loud: await measure(loud), quiet: await measure(quiet) };
    expect(before.loud.lufs).toBeGreaterThan(-10);
    expect(before.quiet.lufs).toBeLessThan(-30);

    for (const [name, audio] of Object.entries({ loud, quiet })) {
      const res = await upload(t, band.token, artistId, `Level ${name}`, audio);
      await t.media.idle();
      const signed = await call<StreamUrl>(t, "GET", `/api/tracks/${res.body.id}/stream`, band.token);
      const after = await measure((await fetchBytes(t, signed.body.url)).body);
      expect(Math.abs(after.lufs - -14)).toBeLessThan(1);
      expect(after.peak).toBeLessThan(-0.5);
    }
  });

  it("still finds AI generators named in the upload's tags", async () => {
    const tagged = synthWav({ seconds: 12, sampleRate: 22_050, seed: 9, comment: "Created with Suno v5" });
    const res = await upload(t, band.token, artistId, "Tagged", tagged);
    expect(res.body).toMatchObject({ processing: "processing", aiScore: 100, flagged: true, scoreSource: "detected" });
    await t.media.idle();
    expect((await call<TrackDetail>(t, "GET", `/api/tracks/${res.body.id}`)).body.processing).toBeNull();
  });

  it("puts a track live as suspended if its artist was suspended while it was processed", async () => {
    await t.media.stop();
    const res = await upload(t, band.token, artistId, "Late One", synthWav({ seconds: 8, sampleRate: 22_050 }));
    await t.database.db.execute(sql`update users set suspended_at = now() where id = ${band.id}`);
    t.media = await MediaProcessor.create({ db: t.database.db, storage: t.storage, ffmpegPath: "ffmpeg" });
    await t.media.idle();
    const [row] = await t.database.db.select({ status: tracks.status }).from(tracks).where(eq(tracks.id, res.body.id));
    expect(row!.status).toBe("suspended");
    await t.database.db.execute(sql`update users set suspended_at = null where id = ${band.id}`);
  });
});

describe.skipIf(!hasFfmpeg)("recovering interrupted work", () => {
  it("runs a job again when the server working on it stopped checking in, but not before", async () => {
    const t = await createTestApp({ media: true });
    try {
      const band = await register(t, "band@trusic.test");
      const artistId = (await call<Artist>(t, "POST", "/api/artists", band.token, { name: "Crashers" })).body.id;
      await t.media.stop();
      const res = await upload(t, band.token, artistId, "Interrupted", synthWav({ seconds: 8, sampleRate: 22_050 }));
      const { db } = t.database;

      // Another server took the job a moment ago and is still working on it: leave it alone.
      await db.update(mediaJobs).set({ status: "running", attempts: 1, heartbeatAt: sql`now()` });
      const patient = await MediaProcessor.create({ db, storage: t.storage, ffmpegPath: "ffmpeg" });
      patient.start();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await patient.stop();
      expect((await db.select().from(mediaJobs))[0]).toMatchObject({ status: "running", attempts: 1 });

      // That server died ten minutes ago, mid-job.
      await db.update(mediaJobs).set({ heartbeatAt: sql`now() - interval '10 minutes'` });
      const fresh = await MediaProcessor.create({ db, storage: t.storage, ffmpegPath: "ffmpeg" });
      await fresh.idle();
      await fresh.stop();
      expect((await db.select().from(mediaJobs))[0]).toMatchObject({ status: "done", attempts: 2 });
      expect((await call<TrackDetail>(t, "GET", `/api/tracks/${res.body.id}`)).body.processing).toBeNull();
    } finally {
      await t.close();
    }
  });

  it("gives up after a few tries, and tells the artist", async () => {
    // An "ffmpeg" that starts but can't convert anything.
    const broken = path.join(scratch, "broken-ffmpeg");
    await writeFile(broken, '#!/bin/sh\necho "ffmpeg version broken" >&2\n[ "$1" = "-encoders" ] && exit 0\nexit 1\n');
    await chmod(broken, 0o755);
    const t = await createTestApp({ media: { ffmpegPath: broken, maxAttempts: 2 } });
    try {
      const band = await register(t, "band@trusic.test");
      const artistId = (await call<Artist>(t, "POST", "/api/artists", band.token, { name: "Unlucky" })).body.id;
      const res = await upload(t, band.token, artistId, "Corrupt", synthWav({ seconds: 8, sampleRate: 22_050 }));
      await t.media.idle();

      const uploads = await call<UploadInProgress[]>(t, "GET", "/api/me/uploads", band.token);
      expect(uploads.body).toMatchObject([{ track: { id: res.body.id }, status: "failed" }]);
      expect(uploads.body[0]!.message).toMatch(/couldn't prepare this file/);
      expect((await call<TrackDetail>(t, "GET", `/api/tracks/${res.body.id}`, band.token)).body.processing).toBe(
        "failed",
      );
      expect((await call(t, "GET", `/api/tracks/${res.body.id}`)).status).toBe(404);
      const [job] = await t.database.db.select().from(mediaJobs);
      expect(job).toMatchObject({ status: "failed", attempts: 2 });

      // The artist can remove it.
      expect((await call(t, "DELETE", `/api/tracks/${res.body.id}`, band.token)).status).toBe(204);
      expect((await call<UploadInProgress[]>(t, "GET", "/api/me/uploads", band.token)).body).toEqual([]);
    } finally {
      await t.close();
    }
  });

  it("without ffmpeg, puts tracks live as uploaded, including any left waiting", async () => {
    const t = await createTestApp({ media: true });
    try {
      const band = await register(t, "band@trusic.test");
      const artistId = (await call<Artist>(t, "POST", "/api/artists", band.token, { name: "No Tools" })).body.id;
      await t.media.stop();
      const res = await upload(t, band.token, artistId, "Waiting", synthWav({ seconds: 8, sampleRate: 22_050 }));
      expect(res.body.processing).toBe("processing");

      const without = await MediaProcessor.create({ db: t.database.db, storage: t.storage, ffmpegPath: "/no/ffmpeg" });
      expect(without.audio).toBe(false);
      expect(without.describe()).toMatch(/wasn't found/);
      const warnings: string[] = [];
      without.start({ info() {}, error() {}, warn: (m) => warnings.push(m) });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(warnings[0]).toMatch(/ffmpeg wasn't found/);
      expect(warnings[1]).toMatch(/1 upload\(s\) were waiting/);
      const live = await call<TrackDetail>(t, "GET", `/api/tracks/${res.body.id}`);
      expect(live.body.processing).toBeNull();
    } finally {
      await t.close();
    }
  });
});

describe.skipIf(!hasFfmpeg)("artwork sizes", () => {
  let t: TestApp;
  let band: { token: string; id: string };
  let releaseId = "";

  beforeAll(async () => {
    t = await createTestApp({ media: true });
    band = await register(t, "band@trusic.test");
    const artist = (await call<Artist>(t, "POST", "/api/artists", band.token, { name: "Picture Band" })).body;
    releaseId = (
      await call<ReleaseDetail>(t, "POST", "/api/releases", band.token, {
        artistId: artist.id,
        title: "Pictures",
        type: "single",
      })
    ).body.id;
  });
  afterAll(async () => {
    await t?.close();
  });

  const setArtwork = async (data: Buffer, filename = "cover.png") =>
    (await sendFile(t, "PUT", `/api/releases/${releaseId}/artwork`, band.token, {}, { name: "image", filename, data }))
      .body as ReleaseDetail;

  it("keeps square WebP copies at each size and sends the one asked for", async () => {
    const url = (await setArtwork(synthPng({ size: 900, seed: 4 }))).artworkUrl!;
    await t.media.idle();

    for (const [query, size] of [
      ["?size=120", 120],
      ["?size=100", 120],
      ["?size=300", 300],
      ["?size=640", 640],
      ["?size=2000", 640],
      ["", 640],
    ] as const) {
      const image = await fetchBytes(t, url + query);
      expect(image.status).toBe(200);
      expect(image.headers["content-type"]).toBe("image/webp");
      expect(image.headers["cache-control"]).toContain("immutable");
      expect(webpSize(image.body)).toEqual({ width: size, height: size });
    }
    const small = await fetchBytes(t, `${url}?size=120`);
    expect(small.body.length).toBeLessThan(15_000);
    expect((await fetchBytes(t, `${url}?size=abc`)).status).toBe(400);
  });

  it("crops to a square and never enlarges", async () => {
    const wide = await generate("wide.png", ["-f", "lavfi", "-i", "color=c=green:s=400x200", "-frames:v", "1"]);
    const url = (await setArtwork(wide)).artworkUrl!;
    await t.media.idle();
    expect(webpSize((await fetchBytes(t, `${url}?size=640`)).body)).toEqual({ width: 200, height: 200 });
    expect(webpSize((await fetchBytes(t, `${url}?size=120`)).body)).toEqual({ width: 120, height: 120 });
  });

  it("turns phone photos the right way up", async () => {
    // Left half red, right half blue, stored sideways with EXIF orientation 6 ("turn 90° clockwise to view").
    const jpeg = await generate("sideways.jpg", [
      ...["-f", "lavfi", "-i", "color=c=red:s=200x100", "-frames:v", "1"],
      ...["-vf", "drawbox=x=100:y=0:w=100:h=100:color=blue:t=fill"],
    ]);
    const exif = Buffer.concat([
      Buffer.from("Exif\0\0MM\0\x2a\0\0\0\x08\0\x01", "latin1"),
      Buffer.from([0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0x00, 0x06, 0, 0, 0, 0, 0, 0]),
    ]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.alloc(2), exif]);
    app1.writeUInt16BE(exif.length + 2, 2);
    const photo = Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
    expect(jpegOrientation(photo)).toBe(6);
    expect(jpegOrientation(jpeg)).toBe(1);

    const url = (await setArtwork(photo, "photo.jpg")).artworkUrl!;
    await t.media.idle();
    const image = (await fetchBytes(t, `${url}?size=120`)).body;
    expect(webpSize(image)).toEqual({ width: 100, height: 100 });
    // Turned upright, the red half is on top: the top-right corner is red, where unturned it would be blue.
    const [r, , b] = await pixel(image, 90, 10);
    expect(r).toBeGreaterThan(180);
    expect(b).toBeLessThan(80);
    const [r2, , b2] = await pixel(image, 90, 90);
    expect(b2).toBeGreaterThan(180);
    expect(r2).toBeLessThan(80);
  });

  it("deletes the resized copies with the image", async () => {
    const url = (await setArtwork(synthPng({ size: 320, seed: 6 }))).artworkUrl!;
    await t.media.idle();
    const name = url
      .split("/")
      .pop()!
      .replace(/\.png$/, "");
    expect(await t.storage.size(`images/${name}-120.webp`)).toBeGreaterThan(0);
    await setArtwork(synthPng({ size: 320, seed: 7 }));
    expect((await fetchBytes(t, url)).status).toBe(404);
    await expect(t.storage.size(`images/${name}-120.webp`)).rejects.toThrow();
    expect(
      await t.database.db
        .select()
        .from(mediaJobs)
        .where(eq(mediaJobs.sourceKey, `images/${name}.png`)),
    ).toEqual([]);
  });
});
