import type { Artist, ReleaseDetail } from "@trusic/client";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { optionalUser, requireUser } from "../auth";
import type { Db } from "../db/client";
import { artists, releases, tracks } from "../db/schema";
import { HttpError } from "../errors";
import { IMAGE_MIME_BY_EXT, storeImage, withUpload } from "../uploads";
import { loadReleaseSummaries, selectTrackSummaries, toArtist, toTrackSummary } from "../views";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-06.");

const CreateRelease = z.object({
  artistId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  type: z.enum(["album", "ep", "single"]),
  releaseDate: date.nullable().optional(),
});

const UpdateRelease = CreateRelease.omit({ artistId: true }).partial();

const ReleaseTracks = z.object({ trackIds: z.array(z.uuid()).max(200) });

export async function loadReleaseDetail(
  db: Db,
  releaseId: string,
  viewer: { id: string } | null,
): Promise<ReleaseDetail | null> {
  const [summary] = await loadReleaseSummaries(db, { ids: [releaseId] });
  if (!summary) return null;
  const [owner] = await db
    .select({ id: artists.ownerUserId })
    .from(artists)
    .where(eq(artists.id, summary.artist.id))
    .limit(1);
  const rows = await selectTrackSummaries(db)
    .where(and(eq(tracks.releaseId, releaseId), eq(tracks.status, "live")))
    .orderBy(asc(tracks.trackNumber), asc(tracks.createdAt));
  const trackList = rows.map(toTrackSummary);
  return {
    ...summary,
    tracks: trackList,
    durationMs: trackList.reduce((acc, t) => acc + t.durationMs, 0),
    isOwner: viewer?.id === owner?.id,
  };
}

export const releaseRoutes =
  ({ db, storage }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /** The release, if the user owns its artist. */
    async function ownedRelease(releaseId: string, userId: string) {
      const [row] = await db
        .select({ release: releases })
        .from(releases)
        .innerJoin(artists, eq(artists.id, releases.artistId))
        .where(and(eq(releases.id, releaseId), eq(artists.ownerUserId, userId)))
        .limit(1);
      if (!row) throw new HttpError(404, "Release not found.");
      return row.release;
    }

    /** The newest releases that have something to play. */
    app.get("/releases", async () => loadReleaseSummaries(db, { withTracks: true, limit: 12 }));

    app.get<{ Params: { id: string } }>("/releases/:id", async (request) => {
      const viewer = await optionalUser(db, request);
      const detail = await loadReleaseDetail(db, z.uuid().parse(request.params.id), viewer);
      if (!detail) throw new HttpError(404, "Release not found.");
      return detail;
    });

    app.post("/releases", async (request, reply) => {
      const user = await requireUser(db, request);
      const body = CreateRelease.parse(request.body);
      const [artist] = await db
        .select({ id: artists.id })
        .from(artists)
        .where(and(eq(artists.id, body.artistId), eq(artists.ownerUserId, user.id)))
        .limit(1);
      if (!artist) throw new HttpError(403, "You can only create releases for your own artist profiles.");
      const [release] = await db
        .insert(releases)
        .values({ artistId: body.artistId, title: body.title, type: body.type, releaseDate: body.releaseDate ?? null })
        .returning({ id: releases.id });
      return reply.code(201).send(await loadReleaseDetail(db, release!.id, user));
    });

    app.patch<{ Params: { id: string } }>("/releases/:id", async (request) => {
      const user = await requireUser(db, request);
      const release = await ownedRelease(z.uuid().parse(request.params.id), user.id);
      const body = UpdateRelease.parse(request.body);
      await db
        .update(releases)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.releaseDate !== undefined ? { releaseDate: body.releaseDate } : {}),
        })
        .where(eq(releases.id, release.id));
      return loadReleaseDetail(db, release.id, user);
    });

    app.delete<{ Params: { id: string } }>("/releases/:id", async (request, reply) => {
      const user = await requireUser(db, request);
      const release = await ownedRelease(z.uuid().parse(request.params.id), user.id);
      // The tracks stay; they just stop being part of a release.
      await db.transaction(async (tx) => {
        await tx.update(tracks).set({ releaseId: null, trackNumber: null }).where(eq(tracks.releaseId, release.id));
        await tx.delete(releases).where(eq(releases.id, release.id));
      });
      if (release.artworkKey) await storage.remove(release.artworkKey);
      return reply.code(204).send();
    });

    /** Set which of the artist's tracks are on the release, in order. */
    app.put<{ Params: { id: string } }>("/releases/:id/tracks", async (request) => {
      const user = await requireUser(db, request);
      const release = await ownedRelease(z.uuid().parse(request.params.id), user.id);
      const { trackIds } = ReleaseTracks.parse(request.body);
      if (new Set(trackIds).size !== trackIds.length) throw new HttpError(400, "A track can only appear once.");

      if (trackIds.length) {
        const found = await db
          .select({ id: tracks.id })
          .from(tracks)
          .where(and(inArray(tracks.id, trackIds), eq(tracks.artistId, release.artistId), eq(tracks.status, "live")));
        if (found.length !== trackIds.length) {
          throw new HttpError(400, "Releases can only contain this artist's own live tracks.");
        }
      }

      await db.transaction(async (tx) => {
        await tx
          .update(tracks)
          .set({ releaseId: null, trackNumber: null })
          .where(
            trackIds.length
              ? and(eq(tracks.releaseId, release.id), notInArray(tracks.id, trackIds))
              : eq(tracks.releaseId, release.id),
          );
        for (const [i, trackId] of trackIds.entries()) {
          await tx
            .update(tracks)
            .set({ releaseId: release.id, trackNumber: i + 1 })
            .where(eq(tracks.id, trackId));
        }
      });
      return loadReleaseDetail(db, release.id, user);
    });

    app.put<{ Params: { id: string } }>("/releases/:id/artwork", async (request) => {
      const user = await requireUser(db, request);
      const release = await ownedRelease(z.uuid().parse(request.params.id), user.id);
      const key = await withUpload(request, storage, "image", ({ filePath }) => storeImage(storage, filePath));
      await db.update(releases).set({ artworkKey: key }).where(eq(releases.id, release.id));
      if (release.artworkKey) await storage.remove(release.artworkKey);
      return loadReleaseDetail(db, release.id, user);
    });

    app.put<{ Params: { id: string } }>("/artists/:id/image", async (request) => {
      const user = await requireUser(db, request);
      const [artist] = await db
        .select()
        .from(artists)
        .where(and(eq(artists.id, z.uuid().parse(request.params.id)), eq(artists.ownerUserId, user.id)))
        .limit(1);
      if (!artist) throw new HttpError(404, "Artist not found.");
      const key = await withUpload(request, storage, "image", ({ filePath }) => storeImage(storage, filePath));
      const [updated] = await db.update(artists).set({ imageKey: key }).where(eq(artists.id, artist.id)).returning();
      if (artist.imageKey) await storage.remove(artist.imageKey);
      return toArtist(updated!) satisfies Artist;
    });

    /** Images are public and never change (each upload gets a new name), so cache them forever. */
    app.get<{ Params: { name: string } }>("/images/:name", async (request, reply) => {
      const m = /^[0-9a-f-]{36}\.(png|jpg|webp)$/.exec(request.params.name);
      if (!m) throw new HttpError(404, "Image not found.");
      const key = `images/${request.params.name}`;
      const size = await storage.size(key).catch(() => null);
      if (size === null) throw new HttpError(404, "Image not found.");
      return reply
        .header("content-type", IMAGE_MIME_BY_EXT[m[1]!]!)
        .header("content-length", size)
        .header("cache-control", "public, max-age=31536000, immutable")
        .send(storage.read(key));
    });
  };
