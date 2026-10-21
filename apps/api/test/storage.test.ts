import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Artist, ReleaseDetail, StreamUrl, TrackDetail } from "@trusic/client";
import { imageSizeFor, imageSources, imageSrcSet, sizedImageUrl } from "@trusic/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sslFor } from "../src/db/client";
import { normalisingGain, parseAnalysis } from "../src/media/audio";
import { pickVariant } from "../src/routes/media";
import { signRequest } from "../src/sigv4";
import { loadS3Config, S3MediaStorage, StorageError } from "../src/storage";
import { synthPng, synthWav } from "../src/synth";
import { startFakeS3, type FakeS3 } from "./fake-s3";
import { call, createTestApp, declaration, register, sendFile, type TestApp } from "./helpers";

const KEYS = { accessKeyId: "test-key", secretAccessKey: "test-secret" };

describe("request signing", () => {
  it("matches AWS's published Signature Version 4 example", () => {
    // "GET Object" from https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
    const headers = signRequest(
      {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        region: "us-east-1",
      },
      {
        method: "GET",
        url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
        headers: { Range: "bytes=0-9" },
        date: new Date("2013-05-24T00:00:00Z"),
      },
    );
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});

describe("storage settings", () => {
  it("uses local disk unless S3 is set up, and refuses half the settings", () => {
    expect(loadS3Config({})).toBeNull();
    expect(() => loadS3Config({ S3_ENDPOINT: "https://x.storage.supabase.co/storage/v1/s3" })).toThrow(
      /also set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/,
    );
    expect(
      loadS3Config({
        S3_ENDPOINT: "https://abcd.storage.supabase.co/storage/v1/s3/",
        S3_BUCKET: "trusic",
        S3_ACCESS_KEY_ID: "id",
        S3_SECRET_ACCESS_KEY: "secret",
      }),
    ).toEqual({
      endpoint: "https://abcd.storage.supabase.co/storage/v1/s3",
      region: "us-east-1",
      bucket: "trusic",
      accessKeyId: "id",
      secretAccessKey: "secret",
    });
  });

  it("encrypts Supabase database connections without needing its certificate", () => {
    expect(sslFor("postgresql://postgres.abcd:pw@aws-0-eu-west-2.pooler.supabase.com:5432/postgres")).toEqual({
      rejectUnauthorized: false,
    });
    expect(sslFor("postgresql://postgres:pw@db.abcd.supabase.co:5432/postgres?sslmode=verify-full")).toBeUndefined();
    expect(sslFor("postgres://trusic:trusic@localhost:5432/trusic")).toBeUndefined();
  });
});

describe("loudness", () => {
  const ebur128 = `
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, 2 channels, s16, 1536 kb/s
[Parsed_ebur128_0 @ 0x5581] Summary:

  Integrated loudness:
    I:          -9.2 LUFS
    Threshold: -19.4 LUFS

  True peak:
    Peak:        0.4 dBFS`;

  it("reads ffmpeg's EBU R128 summary", () => {
    expect(parseAnalysis(ebur128)).toEqual({ integratedLufs: -9.2, truePeakDb: 0.4, sampleRate: 48_000 });
    expect(parseAnalysis("I: -70.0 LUFS\nPeak: -inf dBFS")).toMatchObject({ truePeakDb: null });
  });

  it("turns loud tracks down, and quiet ones up only as far as their peaks allow", () => {
    expect(normalisingGain({ integratedLufs: -9.2, truePeakDb: 0.4, sampleRate: null })).toBe(-4.8);
    expect(normalisingGain({ integratedLufs: -20, truePeakDb: -12, sampleRate: null })).toBe(6);
    // Turning this up 6 dB would push its peak over -1.5 dB, so it only goes up 3.
    expect(normalisingGain({ integratedLufs: -20, truePeakDb: -4.5, sampleRate: null })).toBe(3);
    expect(normalisingGain({ integratedLufs: -70, truePeakDb: null, sampleRate: null })).toBe(0);
    expect(normalisingGain({ integratedLufs: null, truePeakDb: null, sampleRate: null })).toBe(0);
  });
});

describe("image sizes", () => {
  it("picks the smallest copy that's big enough", () => {
    const variants = [640, 120, 300].map((size) => ({ size, key: `k${size}`, bytes: 1, mime: "image/webp" }));
    expect(pickVariant(variants, 50).size).toBe(120);
    expect(pickVariant(variants, 121).size).toBe(300);
    expect(pickVariant(variants, 5000).size).toBe(640);
    expect(pickVariant(variants, null).size).toBe(640);
  });

  it("gives apps sized URLs for Trusic images only", () => {
    expect(imageSizeFor(80)).toBe(120);
    expect(imageSizeFor(400)).toBe(640);
    expect(sizedImageUrl("/api/images/abc.png", 200)).toBe("/api/images/abc.png?size=300");
    expect(sizedImageUrl("https://cdn.example.com/a.png", 200)).toBe("https://cdn.example.com/a.png");
    expect(imageSrcSet("https://trusic.app/api/images/abc.jpg")).toBe(
      "https://trusic.app/api/images/abc.jpg?size=120 120w, https://trusic.app/api/images/abc.jpg?size=300 300w, https://trusic.app/api/images/abc.jpg?size=640 640w",
    );
    expect(imageSrcSet("blob:x")).toBeUndefined();
    expect(imageSources("/api/images/abc.png")).toHaveLength(3);
  });
});

describe("S3-compatible storage", () => {
  let s3: FakeS3;
  let storage: S3MediaStorage;

  beforeAll(async () => {
    // The same shape as Supabase's endpoint, which has a path before the bucket.
    s3 = await startFakeS3({ prefix: "/storage/v1/s3", bucket: "trusic" });
    storage = new S3MediaStorage(
      { endpoint: s3.endpoint, region: "eu-west-2", bucket: "trusic", ...KEYS },
      path.join(tmpdir(), "trusic-s3-test"),
    );
  });
  afterAll(async () => {
    await s3?.close();
  });

  it("stores, measures, reads ranges of and deletes files", async () => {
    const data = Buffer.from("0123456789".repeat(1000));
    const temp = await storage.tempPath();
    await writeFile(temp, data);
    await storage.save("tracks/a b.m4a", temp);
    await expect(readFile(temp)).rejects.toThrow(); // moved, like the local version
    expect(s3.objects.get("tracks/a b.m4a")?.contentType).toBe("audio/mp4");
    expect(await storage.size("tracks/a b.m4a")).toBe(10_000);

    const read = async (range?: { start: number; end: number }) => {
      const chunks: Buffer[] = [];
      for await (const chunk of storage.read("tracks/a b.m4a", range)) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString();
    };
    expect(await read({ start: 5, end: 14 })).toBe("5678901234");
    expect((await read()).length).toBe(10_000);
    expect(s3.requests.at(-2)?.range).toBe("bytes=5-14");

    const copy = await storage.withLocalCopy("tracks/a b.m4a", async (file) => (await readFile(file)).length);
    expect(copy).toBe(10_000);

    await storage.remove("tracks/a b.m4a");
    await storage.remove("tracks/a b.m4a"); // already gone: fine
    await expect(storage.size("tracks/a b.m4a")).rejects.toBeInstanceOf(StorageError);
  });

  it("reports missing files as errors on the stream", async () => {
    const stream = storage.read("nothing/here");
    await expect(
      new Promise((resolve, reject) => {
        stream.on("error", reject);
        stream.on("end", resolve);
        stream.resume();
      }),
    ).rejects.toMatchObject({ status: 404, code: "NoSuchKey" });
  });

  it("checks it can store files, with a helpful message when it can't", async () => {
    await storage.check();
    const wrongBucket = new S3MediaStorage(
      { endpoint: s3.endpoint, region: "eu-west-2", bucket: "nope", ...KEYS },
      path.join(tmpdir(), "trusic-s3-test"),
    );
    await expect(wrongBucket.check()).rejects.toThrow(/Can't store files in the "nope" bucket.*NoSuchBucket/);
  });

  describe("behind the API", () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({ storage });
    });
    afterAll(async () => {
      await t?.close();
    });

    it("uploads, streams with seeking, and serves artwork from the bucket", async () => {
      const band = await register(t, "band@trusic.test");
      const artist = (await call<Artist>(t, "POST", "/api/artists", band.token, { name: "Cloud Band" })).body;
      const wav = synthWav({ seconds: 40, sampleRate: 8000 });
      const res = await sendFile(
        t,
        "POST",
        "/api/tracks",
        band.token,
        { artistId: artist.id, title: "Up There", declaration: JSON.stringify(declaration()) },
        { name: "audio", filename: "up.wav", data: wav },
      );
      const track = res.body as TrackDetail;
      expect(res.status).toBe(201);
      expect(s3.objects.has(`originals/${track.id}.wav`)).toBe(true);

      const signed = await call<StreamUrl>(t, "GET", `/api/tracks/${track.id}/stream`, band.token);
      const part = await t.app.inject({ method: "GET", url: signed.body.url, headers: { range: "bytes=0-99" } });
      expect(part.statusCode).toBe(206);
      expect(part.headers["content-range"]).toBe(`bytes 0-99/${wav.length}`);
      expect(part.rawPayload.equals(wav.subarray(0, 100))).toBe(true);

      const release = (
        await call<ReleaseDetail>(t, "POST", "/api/releases", band.token, {
          artistId: artist.id,
          title: "Up",
          type: "single",
        })
      ).body;
      const art = synthPng({ size: 64 });
      const withArt = await sendFile(
        t,
        "PUT",
        `/api/releases/${release.id}/artwork`,
        band.token,
        {},
        {
          name: "image",
          filename: "a.png",
          data: art,
        },
      );
      const image = await t.app.inject({ method: "GET", url: (withArt.body as ReleaseDetail).artworkUrl! });
      expect(image.statusCode).toBe(200);
      expect(image.rawPayload.equals(art)).toBe(true);
    });
  });

  // Run against a real server (MinIO, R2, Supabase…) with TEST_S3_ENDPOINT, TEST_S3_BUCKET, TEST_S3_REGION,
  // TEST_S3_ACCESS_KEY_ID and TEST_S3_SECRET_ACCESS_KEY set.
  describe.skipIf(!process.env.TEST_S3_ENDPOINT)("against a real server", () => {
    it("stores, reads a range back and deletes", async () => {
      const real = new S3MediaStorage(
        {
          endpoint: process.env.TEST_S3_ENDPOINT!,
          region: process.env.TEST_S3_REGION ?? "us-east-1",
          bucket: process.env.TEST_S3_BUCKET!,
          accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY!,
        },
        path.join(tmpdir(), "trusic-s3-test"),
      );
      await real.check();
      const temp = await real.tempPath();
      await writeFile(temp, "abcdefghijklmnopqrstuvwxyz");
      await real.save("test/alphabet.txt", temp);
      expect(await real.size("test/alphabet.txt")).toBe(26);
      const chunks: Buffer[] = [];
      for await (const chunk of real.read("test/alphabet.txt", { start: 23, end: 25 })) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).toString()).toBe("xyz");
      await real.remove("test/alphabet.txt");
      await expect(real.size("test/alphabet.txt")).rejects.toThrow();
    });
  });
});
