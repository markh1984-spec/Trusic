import { rm, stat } from "node:fs/promises";
import { IMAGE_SIZES } from "@trusic/client";
import { and, asc, count, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { artists, mediaJobs, tracks, users, type ImageVariant } from "../db/schema";
import { PREVIEW_MS } from "../routes/listening";
import type { MediaStorage } from "../storage";
import { analyseAudio, encodeAudio, normalisingGain, STREAM_BITRATE, STREAM_MIME, TARGET_LUFS } from "./audio";
import { findFfmpeg, type Ffmpeg } from "./ffmpeg";
import { IMAGE_MIMES, JPEG_SIZE, resizeImage } from "./images";

export interface Log {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const quiet: Log = { info() {}, warn() {}, error() {} };

type MediaJob = typeof mediaJobs.$inferSelect;
type JobKind = MediaJob["kind"];

export interface MediaProcessorOptions {
  db: Db;
  storage: MediaStorage;
  /** How to run ffmpeg. Null turns processing off: uploads are streamed and shown exactly as uploaded. */
  ffmpegPath: string | null;
  /** How many times to try a job before giving up. */
  maxAttempts?: number;
  /** After a failed try, wait this long times the number of tries so far. */
  retryDelayMs?: number;
  /** A running job that hasn't checked in for this long was interrupted (by a restart, say), and is run again. */
  leaseMs?: number;
}

/**
 * Delete stored files along with anything made from them (an image's resized copies), and forget their jobs. A job
 * still running finds its row gone and deletes what it made. Files that are already gone are fine.
 */
export async function removeMediaFiles(db: Db | Tx, storage: MediaStorage, keys: string[]): Promise<void> {
  const unique = [...new Set(keys)];
  if (!unique.length) return;
  const jobs = await db
    .delete(mediaJobs)
    .where(inArray(mediaJobs.sourceKey, unique))
    .returning({ variants: mediaJobs.variants });
  const made = jobs.flatMap((j) => (j.variants ?? []).map((v) => v.key));
  for (const key of [...unique, ...made]) await storage.remove(key).catch(() => undefined);
}

const HEARTBEAT_MS = 20_000;
const MB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Prepares uploads in the background, one at a time, so an upload request never waits for it and the server stays
 * within free hosting's 0.1 CPU and 512 MB:
 *
 * - **Audio** is measured for loudness, then converted to AAC (see audio.ts), with a separate 30-second preview.
 *   The upload itself is kept privately. The track is "processing" (and not public) until this is done.
 * - **Images** are cropped square and resized (see images.ts). Until then the upload itself is shown.
 *
 * Jobs are rows in media_jobs, so work interrupted by a restart is picked up again. Without ffmpeg, nothing is
 * converted: tracks go live straight away and play as uploaded.
 */
export class MediaProcessor {
  private log: Log = quiet;
  private started = false;
  private stopping = false;
  private running: Promise<void> | null = null;
  private again = false;
  private timer: NodeJS.Timeout | null = null;
  private current: AbortController | null = null;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly leaseMs: number;

  static async create(options: MediaProcessorOptions): Promise<MediaProcessor> {
    const ffmpeg = options.ffmpegPath ? await findFfmpeg(options.ffmpegPath) : null;
    return new MediaProcessor(options, ffmpeg);
  }

  private constructor(
    private readonly options: MediaProcessorOptions,
    private readonly ffmpeg: Ffmpeg | null,
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 60_000;
    // Three missed check-ins. A restart takes longer than that on free hosting, so interrupted work resumes soon after.
    this.leaseMs = options.leaseMs ?? 3 * HEARTBEAT_MS;
  }

  /** Whether uploaded audio is converted (if not, it's streamed as uploaded). */
  get audio(): boolean {
    return this.ffmpeg !== null;
  }

  /** Whether uploaded images are resized (if not, they're shown as uploaded). */
  get images(): boolean {
    return this.ffmpeg?.webp ?? false;
  }

  private get kinds(): JobKind[] {
    return [...(this.audio ? (["audio"] as const) : []), ...(this.images ? (["image"] as const) : [])];
  }

  /** What happens to uploads, in a sentence, for the logs. */
  describe(): string {
    const ff = this.ffmpeg;
    if (!this.options.ffmpegPath) {
      return "Media processing is off (FFMPEG_PATH=off): audio and images are served exactly as uploaded.";
    }
    if (!ff) {
      return (
        `ffmpeg wasn't found (tried "${this.options.ffmpegPath}"), so uploads are served exactly as uploaded: audio ` +
        "isn't converted or loudness-matched, and artwork isn't resized. Install ffmpeg, or set FFMPEG_PATH, to turn this on."
      );
    }
    return (
      `Uploads are converted with ffmpeg ${ff.version} to ${STREAM_BITRATE}bps AAC at about ${TARGET_LUFS} LUFS` +
      (ff.webp ? ", and artwork is resized." : "; artwork isn't resized because this ffmpeg has no WebP encoder.")
    );
  }

  /** Begin working through jobs, including any left from before a restart. */
  start(log: Log = this.log): void {
    this.log = log;
    if (this.started) return;
    this.started = true;
    // Only a missing ffmpeg is worth a warning: turning it off on purpose isn't.
    (this.ffmpeg || !this.options.ffmpegPath ? log.info : log.warn).call(log, this.describe());
    void this.releaseUnprocessable().then(() => this.wake());
  }

  /** Look for new work. Call after queueing a job. */
  wake(): void {
    if (!this.started || this.stopping || this.kinds.length === 0) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.drain()
      .catch((error: Error) => this.log.error(`Media processing stopped unexpectedly: ${error.message}`))
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          this.wake();
        } else {
          void this.scheduleNext();
        }
      });
  }

  /**
   * Wait until every upload has been processed, here or by another server sharing the database. The seed script
   * uses this before it puts tracks on releases, which needs them live.
   */
  async idle(): Promise<void> {
    if (!this.started) this.start();
    const kinds = this.kinds;
    if (kinds.length === 0) return;
    for (;;) {
      this.wake();
      await this.running;
      const [left] = await this.options.db
        .select({ n: count() })
        .from(mediaJobs)
        .where(and(inArray(mediaJobs.status, ["pending", "running"]), inArray(mediaJobs.kind, kinds)));
      if (!left?.n) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  /** Stop after abandoning the current job, which is picked up again next time without counting as a try. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.current?.abort();
    await this.running;
  }

  /** Queue a new track's upload, in the same transaction that creates the track (whose status is "processing"). */
  async queueAudio(tx: Tx, trackId: string, sourceKey: string): Promise<void> {
    await tx.insert(mediaJobs).values({ kind: "audio", sourceKey, trackId });
  }

  /** Queue a newly stored image for resizing. */
  async queueImage(sourceKey: string): Promise<void> {
    if (!this.images) return;
    await this.options.db.insert(mediaJobs).values({ kind: "image", sourceKey }).onConflictDoNothing();
    this.wake();
  }

  /** Delete an image and its resized copies. */
  async removeImage(key: string): Promise<void> {
    await removeMediaFiles(this.options.db, this.options.storage, [key]);
  }

  /** The resized copies of an image, once they're ready; null until then (or if it won't be resized). */
  async imageVariants(key: string): Promise<{ variants: ImageVariant[] | null; pending: boolean }> {
    const [job] = await this.options.db
      .select({ status: mediaJobs.status, variants: mediaJobs.variants })
      .from(mediaJobs)
      .where(eq(mediaJobs.sourceKey, key))
      .limit(1);
    return {
      variants: job?.status === "done" && job.variants?.length ? job.variants : null,
      pending: job?.status === "pending" || job?.status === "running",
    };
  }

  /**
   * Work this server can't do (ffmpeg missing, say, after it was available before) is let go rather than left
   * waiting: tracks go live as uploaded, and images are shown as uploaded.
   */
  private async releaseUnprocessable(): Promise<void> {
    const { db } = this.options;
    const stuck: JobKind[] = [];
    if (!this.audio) stuck.push("audio");
    if (!this.images) stuck.push("image");
    if (!stuck.length) return;
    const released = await db.transaction(async (tx) => {
      const jobs = await tx
        .delete(mediaJobs)
        .where(and(inArray(mediaJobs.kind, stuck), inArray(mediaJobs.status, ["pending", "running"])))
        .returning({ trackId: mediaJobs.trackId });
      const trackIds = jobs.flatMap((j) => (j.trackId ? [j.trackId] : []));
      if (trackIds.length) {
        await tx
          .update(tracks)
          .set({ status: "live" })
          .where(and(inArray(tracks.id, trackIds), eq(tracks.status, "processing")));
      }
      return jobs.length;
    });
    if (released) this.log.warn(`${released} upload(s) were waiting to be processed; they're now served as uploaded.`);
  }

  private async drain(): Promise<void> {
    while (!this.stopping) {
      this.again = false;
      const job = await this.claim();
      if (!job) return;
      await this.run(job);
    }
  }

  /** Take the next job (images first: they're quick), or one whose server stopped checking in. */
  private async claim(): Promise<MediaJob | null> {
    const leaseSeconds = this.leaseMs / 1000;
    return this.options.db.transaction(async (tx) => {
      const [next] = await tx
        .select({ id: mediaJobs.id })
        .from(mediaJobs)
        .where(
          and(
            inArray(mediaJobs.kind, this.kinds),
            or(
              and(eq(mediaJobs.status, "pending"), lte(mediaJobs.runAfter, sql`now()`)),
              and(
                eq(mediaJobs.status, "running"),
                lt(mediaJobs.heartbeatAt, sql`now() - ${leaseSeconds}::float8 * interval '1 second'`),
              ),
            ),
          ),
        )
        .orderBy(sql`case when ${mediaJobs.kind} = 'image' then 0 else 1 end`, asc(mediaJobs.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!next) return null;
      const [job] = await tx
        .update(mediaJobs)
        .set({ status: "running", attempts: sql`${mediaJobs.attempts} + 1`, heartbeatAt: sql`now()` })
        .where(eq(mediaJobs.id, next.id))
        .returning();
      return job ?? null;
    });
  }

  private async run(job: MediaJob): Promise<void> {
    const { db, storage } = this.options;
    const controller = new AbortController();
    this.current = controller;
    const heartbeat = setInterval(() => {
      db.update(mediaJobs)
        .set({ heartbeatAt: sql`now()` })
        .where(eq(mediaJobs.id, job.id))
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    try {
      let variants: ImageVariant[] | null = null;
      let made: string[];
      if (job.kind === "audio") {
        made = await this.processAudio(job, controller.signal);
      } else {
        variants = await this.processImage(job, controller.signal);
        made = variants.map((v) => v.key);
      }
      const [still] = await db
        .update(mediaJobs)
        .set({ status: "done", error: null, finishedAt: sql`now()`, ...(variants ? { variants } : {}) })
        .where(eq(mediaJobs.id, job.id))
        .returning({ id: mediaJobs.id });
      // The upload was deleted (a replaced image, a deleted account) while we worked on it.
      if (!still) for (const key of made) await storage.remove(key).catch(() => undefined);
    } catch (error) {
      await this.failed(job, error as Error);
    } finally {
      clearInterval(heartbeat);
      this.current = null;
    }
  }

  private async failed(job: MediaJob, error: Error): Promise<void> {
    const { db } = this.options;
    if (this.stopping) {
      await db
        .update(mediaJobs)
        .set({ status: "pending", attempts: sql`greatest(${mediaJobs.attempts} - 1, 0)` })
        .where(eq(mediaJobs.id, job.id))
        .catch(() => undefined);
      return;
    }
    const what = job.kind === "audio" ? `track ${job.trackId}` : job.sourceKey;
    if (job.attempts < this.maxAttempts) {
      const wait = (this.retryDelayMs * job.attempts) / 1000;
      this.log.warn(
        `Couldn't process ${what} (try ${job.attempts} of ${this.maxAttempts}), trying again: ${error.message}`,
      );
      await db
        .update(mediaJobs)
        .set({ status: "pending", error: error.message, runAfter: sql`now() + ${wait}::float8 * interval '1 second'` })
        .where(eq(mediaJobs.id, job.id));
      return;
    }
    this.log.error(`Gave up processing ${what} after ${job.attempts} tries: ${error.message}`);
    await db.transaction(async (tx) => {
      await tx
        .update(mediaJobs)
        .set({ status: "failed", error: error.message, finishedAt: sql`now()` })
        .where(eq(mediaJobs.id, job.id));
      // The artist sees this in Studio and can upload the track again. (A failed image just stays as uploaded.)
      if (job.trackId) {
        await tx
          .update(tracks)
          .set({ status: "failed" })
          .where(and(eq(tracks.id, job.trackId), eq(tracks.status, "processing")));
      }
    });
  }

  /** Make the streaming files for a track. Returns their keys. */
  private async processAudio(job: MediaJob, signal: AbortSignal): Promise<string[]> {
    const { db, storage } = this.options;
    const ffmpeg = this.ffmpeg!;
    const [track] = await db
      .select({ id: tracks.id, durationMs: tracks.durationMs, status: tracks.status })
      .from(tracks)
      .where(eq(tracks.id, job.trackId!))
      .limit(1);
    // Deleted by the artist before we got to it.
    if (!track || track.status === "removed") return [];
    // Generous: at 0.1 of a CPU a four-minute track takes about two minutes.
    const timeoutMs = 10 * 60_000 + track.durationMs;

    return storage.withLocalCopy(job.sourceKey, async (input) => {
      const analysis = await analyseAudio(ffmpeg, input, { timeoutMs, signal });
      const gainDb = normalisingGain(analysis);
      const full = await storage.tempPath();
      const preview = track.durationMs > PREVIEW_MS ? await storage.tempPath() : null;
      try {
        await encodeAudio(ffmpeg, input, {
          gainDb,
          sampleRate: analysis.sampleRate,
          full,
          preview,
          previewSeconds: PREVIEW_MS / 1000,
          timeoutMs,
          signal,
        });
        const audioBytes = (await stat(full)).size;
        const previewAudioBytes = preview ? (await stat(preview)).size : null;
        const audioKey = `tracks/${track.id}.m4a`;
        const previewAudioKey = preview ? `previews/${track.id}.m4a` : null;
        await storage.save(audioKey, full);
        if (preview) await storage.save(previewAudioKey!, preview);

        await db.transaction(async (tx) => {
          await tx
            .update(tracks)
            .set({
              audioKey,
              audioMimeType: STREAM_MIME,
              audioBytes,
              previewAudioKey,
              previewAudioBytes,
              loudnessLufs: analysis.integratedLufs,
              loudnessGainDb: gainDb,
              audioProcessedAt: sql`now()`,
            })
            .where(eq(tracks.id, track.id));
          // Now it can go public, unless the artist was suspended (three strikes) in the meantime.
          const [owner] = await tx
            .select({ suspendedAt: users.suspendedAt })
            .from(tracks)
            .innerJoin(artists, eq(artists.id, tracks.artistId))
            .innerJoin(users, eq(users.id, artists.ownerUserId))
            .where(eq(tracks.id, track.id));
          await tx
            .update(tracks)
            .set({ status: owner?.suspendedAt ? "suspended" : "live" })
            .where(and(eq(tracks.id, track.id), eq(tracks.status, "processing")));
        });
        const source = (await stat(input)).size;
        this.log.info(
          `Track ${track.id} is ready: ${MB(source)} upload → ${MB(audioBytes)} to stream` +
            (analysis.integratedLufs === null ? "" : `, ${analysis.integratedLufs} LUFS adjusted by ${gainDb} dB`),
        );
        return previewAudioKey ? [audioKey, previewAudioKey] : [audioKey];
      } finally {
        await rm(full, { force: true });
        if (preview) await rm(preview, { force: true });
      }
    });
  }

  private async processImage(job: MediaJob, signal: AbortSignal): Promise<ImageVariant[]> {
    const { storage } = this.options;
    const ffmpeg = this.ffmpeg!;
    return storage.withLocalCopy(job.sourceKey, async (input) => {
      const wanted = [
        ...IMAGE_SIZES.map((size) => ({ size, format: "webp" as const })),
        { size: JPEG_SIZE, format: "jpeg" as const },
      ];
      const outputs = await Promise.all(wanted.map(async (o) => ({ ...o, path: await storage.tempPath() })));
      try {
        await resizeImage(ffmpeg, input, { outputs, timeoutMs: 5 * 60_000, signal });
        const base = job.sourceKey.replace(/\.[a-z0-9]+$/i, "");
        const variants: ImageVariant[] = [];
        for (const { size, format, path } of outputs) {
          const key = `${base}-${size}.${format === "webp" ? "webp" : "jpg"}`;
          const bytes = (await stat(path)).size;
          await storage.save(key, path);
          variants.push({ size, key, bytes, mime: IMAGE_MIMES[format] });
        }
        return variants;
      } finally {
        for (const { path } of outputs) await rm(path, { force: true });
      }
    });
  }

  /** Come back when a delayed retry is due, or when another server's job may have been interrupted. */
  private async scheduleNext(): Promise<void> {
    if (this.stopping || this.kinds.length === 0) return;
    const rows = await this.options.db
      .select({
        dueIn: sql<number>`extract(epoch from min(case when ${mediaJobs.status} = 'pending' then ${mediaJobs.runAfter}
          else ${mediaJobs.heartbeatAt} + ${this.leaseMs / 1000}::float8 * interval '1 second' end) - now())`,
      })
      .from(mediaJobs)
      .where(and(inArray(mediaJobs.status, ["pending", "running"]), inArray(mediaJobs.kind, this.kinds)))
      .catch(() => []);
    const dueIn = rows[0]?.dueIn;
    if (dueIn === null || dueIn === undefined) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.wake(), Math.max(1000, Number(dueIn) * 1000 + 100));
    this.timer.unref();
  }
}
