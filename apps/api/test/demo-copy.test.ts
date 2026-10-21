import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Artist, ReleaseDetail, StreamUrl, TrackDetail } from "@trusic/client";
import { count } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { openDatabase, type Database } from "../src/db/client";
import { tracks } from "../src/db/schema";
import { copyDemoData, tablesInOrder } from "../src/demo-copy";
import { MetadataDetector } from "../src/detection";
import { MemoryMailer } from "../src/mailer";
import { findFfmpeg } from "../src/media/ffmpeg";
import { MediaProcessor } from "../src/media/processor";
import { LocalMediaStorage, S3MediaStorage } from "../src/storage";
import { synthPng, synthWav } from "../src/synth";
import { startFakeS3, type FakeS3 } from "./fake-s3";
import { call, createTestApp, declaration, register, sendFile, type TestApp } from "./helpers";

const hasFfmpeg = (await findFfmpeg("ffmpeg")) !== null;

describe("copying the demo data", () => {
  it("orders tables so each comes after the tables it refers to", () => {
    const order = tablesInOrder();
    const names = order.map((t) => getTableConfig(t).name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("media_jobs");
    for (const [i, table] of order.entries()) {
      for (const fk of getTableConfig(table).foreignKeys) {
        const parent = fk.reference().foreignTable;
        if (parent !== table) expect(order.indexOf(parent)).toBeLessThan(i);
      }
    }
  });

  describe.skipIf(!hasFfmpeg)("into a lasting database and S3 storage", () => {
    let dir = "";
    let source: TestApp;
    let target: Database;
    let s3: FakeS3;
    let bucket: S3MediaStorage;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      dir = await mkdtemp(path.join(tmpdir(), "trusic-demo-copy-"));
      // A small "demo": a converted track with artwork, as the Docker image is built with.
      source = await createTestApp({ media: true, storage: new LocalMediaStorage(path.join(dir, "media")) });
      const band = await register(source, "band@trusic.test");
      const artist = (await call<Artist>(source, "POST", "/api/artists", band.token, { name: "Demo Band" })).body;
      const track = await sendFile(
        source,
        "POST",
        "/api/tracks",
        band.token,
        { artistId: artist.id, title: "Demo Song", declaration: JSON.stringify(declaration()) },
        { name: "audio", filename: "demo.wav", data: synthWav({ seconds: 35, sampleRate: 22_050 }) },
      );
      ids.track = (track.body as TrackDetail).id;
      await source.media.idle();
      const release = await call<ReleaseDetail>(source, "POST", "/api/releases", band.token, {
        artistId: artist.id,
        title: "Demo EP",
        type: "ep",
      });
      ids.release = release.body.id;
      await call(source, "PUT", `/api/releases/${ids.release}/tracks`, band.token, { trackIds: [ids.track] });
      const image = { name: "image", filename: "cover.png", data: synthPng({ size: 400 }) };
      await sendFile(source, "PUT", `/api/releases/${ids.release}/artwork`, band.token, {}, image);
      await source.media.idle();

      s3 = await startFakeS3({ bucket: "trusic" });
      bucket = new S3MediaStorage(
        { endpoint: s3.endpoint, region: "eu-west-2", bucket: "trusic", accessKeyId: "k", secretAccessKey: "s" },
        path.join(dir, "tmp"),
      );
      target = await openDatabase({});
    });
    afterAll(async () => {
      await source?.close();
      await target?.close();
      await s3?.close();
      await rm(dir, { recursive: true, force: true });
    });

    it("copies every row and file, and the site works from the copy", async () => {
      const copied = await copyDemoData({
        source: source.database.db,
        target: target.db,
        mediaDir: path.join(dir, "media"),
        storage: bucket,
      });
      // The upload, the streaming copy, the preview, and the artwork with its four resized copies.
      expect(copied.files).toBe(8);
      expect([...s3.objects.keys()].sort()).toEqual(
        expect.arrayContaining([`originals/${ids.track}.wav`, `tracks/${ids.track}.m4a`, `previews/${ids.track}.m4a`]),
      );
      for (const table of tablesInOrder()) {
        const [a] = await source.database.db.select({ n: count() }).from(table);
        const [b] = await target.db.select({ n: count() }).from(table);
        expect([getTableConfig(table).name, b!.n]).toEqual([getTableConfig(table).name, a!.n]);
      }
      expect(copied.rows).toBeGreaterThan(5);

      const media = await MediaProcessor.create({ db: target.db, storage: bucket, ffmpegPath: null });
      const app = await buildApp({
        db: target.db,
        storage: bucket,
        detector: new MetadataDetector(),
        config: loadConfig({ TRUSIC_DATA_DIR: dir }),
        stripe: null,
        mailer: new MemoryMailer(),
        media,
      });
      try {
        const signed = (await app.inject({ method: "GET", url: `/api/tracks/${ids.track}/stream` })).json<StreamUrl>();
        const preview = await app.inject({ method: "GET", url: signed.url, headers: { range: "bytes=0-99" } });
        expect(preview.statusCode).toBe(206);
        expect(preview.headers["content-type"]).toBe("audio/mp4");
        const release = (
          await app.inject({ method: "GET", url: `/api/releases/${ids.release}` })
        ).json<ReleaseDetail>();
        const art = await app.inject({ method: "GET", url: `${release.artworkUrl}?size=120` });
        expect(art.headers["content-type"]).toBe("image/webp");
      } finally {
        await app.close();
      }
    });

    it("leaves the target empty if the copy fails part-way", async () => {
      const empty = await openDatabase({});
      try {
        // Copying into a database that already has these rows fails on the first duplicate.
        await expect(
          copyDemoData({
            source: source.database.db,
            target: target.db,
            mediaDir: path.join(dir, "media"),
            storage: null,
          }),
        ).rejects.toThrow();
        const [before] = await target.db.select({ n: count() }).from(tracks);
        expect(before!.n).toBe(1);
        const [none] = await empty.db.select({ n: count() }).from(tracks);
        expect(none!.n).toBe(0);
      } finally {
        await empty.close();
      }
    });
  });
});
