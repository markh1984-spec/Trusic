import { createHash } from "node:crypto";
import type { FailedUpload, UploadInProgress, UploadStatus } from "@trusic/client";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { optionalUser, requireAdmin, requireUser } from "../auth";
import { artists, mediaJobs, releases, tracks, users, type ImageVariant } from "../db/schema";
import { HttpError } from "../errors";
import { failureMessage, failureReason } from "../media/failures";
import { imageAccess } from "../media/image-access";
import { IMAGE_MIMES } from "../media/images";
import { IMAGE_MIME_BY_EXT } from "../uploads";

/**
 * Public pictures are kept for an hour, then checked again (a tiny "304 Not Modified" if nothing has changed). Each
 * upload gets a new address, so they could be kept forever, but then a picture taken down after a report, or a
 * deleted account's, would carry on showing wherever it had been seen.
 */
const PUBLIC_CACHE = "public, max-age=3600";
/** Smaller copies are on their way, so don't keep the upload itself for long. */
const PENDING_CACHE = "public, max-age=60";
/** Pictures only their owner and admins can see are never kept by browsers or anything in between. */
const PRIVATE_CACHE = "private, no-store";

/** The smallest copy at least `size` pixels across, or the largest if none is (or no size was asked for). */
export function pickVariant(variants: ImageVariant[], size: number | null): ImageVariant {
  const sorted = [...variants].sort((a, b) => a.size - b.size);
  return (size === null ? undefined : sorted.find((v) => v.size >= size)) ?? sorted[sorted.length - 1]!;
}

/** A stored file never changes (new uploads get new names), so its name is all an ETag needs. */
const etagOf = (key: string) => `"${createHash("sha256").update(key).digest("base64url").slice(0, 22)}"`;

export const mediaRoutes =
  ({ db, storage, media }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /** The signed-in artist's uploads that aren't live yet: still being prepared, or failed. */
    app.get("/me/uploads", async (request) => {
      const user = await requireUser(db, request);
      const rows = await db
        .select({
          id: tracks.id,
          title: tracks.title,
          status: tracks.status,
          originalAudioKey: tracks.originalAudioKey,
          createdAt: tracks.createdAt,
          artistId: artists.id,
          artistName: artists.name,
          artistSlug: artists.slug,
          error: mediaJobs.error,
        })
        .from(tracks)
        .innerJoin(artists, eq(artists.id, tracks.artistId))
        .leftJoin(mediaJobs, and(eq(mediaJobs.trackId, tracks.id), eq(mediaJobs.kind, "audio")))
        .where(and(eq(artists.ownerUserId, user.id), inArray(tracks.status, ["processing", "failed"])))
        .orderBy(desc(tracks.createdAt));
      return rows.map((r): UploadInProgress => {
        const canRetry = r.status === "failed" && r.originalAudioKey !== null && media.audio;
        return {
          track: { id: r.id, title: r.title },
          artist: { id: r.artistId, name: r.artistName, slug: r.artistSlug },
          status: r.status as UploadStatus,
          message: r.status === "failed" ? failureMessage(r.error, canRetry) : null,
          canRetry,
          uploadedAt: r.createdAt.toISOString(),
        };
      });
    });

    /** Convert a failed upload again from the file as it was uploaded (which is always kept). */
    async function retryTrack(trackId: string) {
      const [track] = await db
        .select({ status: tracks.status, originalAudioKey: tracks.originalAudioKey })
        .from(tracks)
        .where(eq(tracks.id, trackId))
        .limit(1);
      if (!track) throw new HttpError(404, "Track not found.");
      if (track.status !== "failed")
        throw new HttpError(409, "Only uploads that couldn't be converted can be retried.");
      if (!media.audio) throw new HttpError(503, "Trusic can't convert uploads at the moment. Please try later.");
      const source = track.originalAudioKey;
      const kept =
        source !== null &&
        (await storage.size(source).then(
          () => true,
          () => false,
        ));
      if (!kept) {
        throw new HttpError(
          409,
          "We no longer have the file you uploaded, so it can't be tried again. Please upload it again.",
        );
      }
      if (!(await media.retryAudio(trackId, source))) {
        throw new HttpError(409, "Only uploads that couldn't be converted can be retried.");
      }
    }

    /** "Try again" on a failed upload, by its uploader or an admin. */
    app.post<{ Params: { id: string } }>(
      "/tracks/:id/retry",
      { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
      async (request, reply) => {
        const user = await requireUser(db, request);
        const trackId = z.uuid().parse(request.params.id);
        const [owned] = await db
          .select({ ownerUserId: artists.ownerUserId })
          .from(tracks)
          .innerJoin(artists, eq(artists.id, tracks.artistId))
          .where(eq(tracks.id, trackId))
          .limit(1);
        if (!owned || (owned.ownerUserId !== user.id && !user.isAdmin)) throw new HttpError(404, "Track not found.");
        await retryTrack(trackId);
        return reply.code(204).send();
      },
    );

    /** Uploads the server gave up on: audio it couldn't convert, and artwork it couldn't resize. */
    app.get("/admin/uploads/failed", async (request) => {
      await requireAdmin(db, request);
      const rows = await db
        .select({
          job: mediaJobs,
          track: { id: tracks.id, title: tracks.title, status: tracks.status, original: tracks.originalAudioKey },
          artist: { id: artists.id, name: artists.name, slug: artists.slug },
          owner: { id: users.id, displayName: users.displayName, email: users.email },
        })
        .from(mediaJobs)
        .leftJoin(tracks, eq(tracks.id, mediaJobs.trackId))
        .leftJoin(artists, eq(artists.id, tracks.artistId))
        .leftJoin(users, eq(users.id, artists.ownerUserId))
        // Not ones their artist has since removed.
        .where(and(eq(mediaJobs.status, "failed"), or(isNull(mediaJobs.trackId), ne(tracks.status, "removed"))))
        .orderBy(desc(mediaJobs.finishedAt))
        .limit(200);

      // A picture belongs to whichever release or profile uses it.
      const imageKeys = rows.filter((r) => r.job.kind === "image").map((r) => r.job.sourceKey);
      const using = new Map<string, Pick<FailedUpload, "artist" | "owner">>();
      if (imageKeys.length) {
        const columns = {
          artist: { id: artists.id, name: artists.name, slug: artists.slug },
          owner: { id: users.id, displayName: users.displayName, email: users.email },
        };
        const [onReleases, onArtists] = await Promise.all([
          db
            .select({ key: releases.artworkKey, ...columns })
            .from(releases)
            .innerJoin(artists, eq(artists.id, releases.artistId))
            .innerJoin(users, eq(users.id, artists.ownerUserId))
            .where(inArray(releases.artworkKey, imageKeys)),
          db
            .select({ key: artists.imageKey, ...columns })
            .from(artists)
            .innerJoin(users, eq(users.id, artists.ownerUserId))
            .where(inArray(artists.imageKey, imageKeys)),
        ]);
        for (const { key, ...who } of [...onReleases, ...onArtists]) using.set(key!, who);
      }

      return rows.map(({ job, track, artist, owner }): FailedUpload => {
        const image = job.kind === "image";
        return {
          jobId: job.id,
          kind: job.kind,
          track: track ? { id: track.id, title: track.title } : null,
          artist: image ? (using.get(job.sourceKey)?.artist ?? null) : artist,
          owner: image ? (using.get(job.sourceKey)?.owner ?? null) : owner,
          reason: failureReason(job.error),
          error: job.error,
          attempts: job.attempts,
          failedAt: job.finishedAt?.toISOString() ?? null,
          canRetry: image ? media.images : track?.status === "failed" && track.original !== null && media.audio,
        };
      }) satisfies FailedUpload[];
    });

    app.post<{ Params: { jobId: string } }>("/admin/uploads/failed/:jobId/retry", async (request, reply) => {
      await requireAdmin(db, request);
      const [job] = await db
        .select()
        .from(mediaJobs)
        .where(eq(mediaJobs.id, z.uuid().parse(request.params.jobId)))
        .limit(1);
      if (!job) throw new HttpError(404, "That upload isn't waiting to be tried again.");
      if (job.kind === "audio") {
        if (!job.trackId) throw new HttpError(404, "Track not found.");
        await retryTrack(job.trackId);
      } else {
        if (!media.images) throw new HttpError(503, "Trusic can't resize pictures at the moment. Please try later.");
        if (!(await media.retryImage(job.id)))
          throw new HttpError(409, "Only pictures that couldn't be resized can be retried.");
      }
      return reply.code(204).send();
    });

    /**
     * Artwork and artist photos. `?size=` picks one of the resized WebP copies (see IMAGE_SIZES); without it, the
     * largest. `?format=jpeg` asks for the JPEG copy instead, for things that can't read WebP (the link-preview
     * pictures in share/). Until the copies are made, or if they can't be, the upload itself is sent.
     *
     * A picture is public while a release or profile anyone can see shows it. Once it's taken down after a report
     * (on its own, or with its release or artist), or its account is deleted, only its owner and admins can load
     * it (with their login, see apps/web's Artwork), so an address handed out earlier stops working.
     */
    app.get<{ Params: { name: string }; Querystring: { size?: string; format?: string } }>(
      "/images/:name",
      async (request, reply) => {
        const m = /^[0-9a-f-]{36}\.(png|jpg|webp)$/.exec(request.params.name);
        if (!m) throw new HttpError(404, "Image not found.");
        const key = `images/${request.params.name}`;
        const size = request.query.size ? z.coerce.number().int().min(1).max(4096).parse(request.query.size) : null;
        const mime = IMAGE_MIMES[z.enum(["webp", "jpeg"]).default("webp").parse(request.query.format)];

        // Who's asking matters, so caches mustn't hand one person's answer to another.
        reply.header("vary", "authorization");
        const [access, viewer] = await Promise.all([imageAccess(db, key), optionalUser(db, request)]);
        const allowed = access.public || viewer?.isAdmin || (viewer && access.ownerUserIds.includes(viewer.id));
        if (!allowed) {
          reply.header("cache-control", "no-store");
          throw new HttpError(404, "Image not found.");
        }

        const { variants: all, pending } = await media.imageVariants(key);
        const variants = all?.filter((v) => v.mime === mime);
        if (variants?.length) {
          const variant = pickVariant(variants, size);
          return send(request, reply, {
            key: variant.key,
            mime: variant.mime,
            bytes: variant.bytes,
            cache: access.public ? PUBLIC_CACHE : PRIVATE_CACHE,
          });
        }
        const bytes = await storage.size(key).catch(() => null);
        if (bytes === null) throw new HttpError(404, "Image not found.");
        return send(request, reply, {
          key,
          mime: IMAGE_MIME_BY_EXT[m[1]!]!,
          bytes,
          cache: !access.public ? PRIVATE_CACHE : pending ? PENDING_CACHE : PUBLIC_CACHE,
        });
      },
    );

    /** Send a stored image, or "304 Not Modified" when the browser already has this one. */
    function send(
      request: FastifyRequest,
      reply: FastifyReply,
      file: { key: string; mime: string; bytes: number; cache: string },
    ) {
      const etag = etagOf(file.key);
      reply.header("cache-control", file.cache).header("etag", etag);
      if (request.headers["if-none-match"] === etag) return reply.code(304).send();
      return reply.header("content-type", file.mime).header("content-length", file.bytes).send(storage.read(file.key));
    }
  };
