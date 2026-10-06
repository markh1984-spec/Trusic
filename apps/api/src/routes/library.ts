import type { Artist, HistoryItem, LibraryIds, LikedTrack } from "@trusic/client";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireUser } from "../auth";
import { artists, follows, likes, plays, tracks } from "../db/schema";
import { HttpError } from "../errors";
import { selectTrackSummaries, selectTrackSummariesWith, toArtist, toTrackSummary } from "../views";

const HISTORY_LIMIT = 50;

export const libraryRoutes =
  ({ db }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.get("/me/library", async (request) => {
      const user = await requireUser(db, request);
      const [liked, followed] = await Promise.all([
        db.select({ id: likes.trackId }).from(likes).where(eq(likes.userId, user.id)),
        db.select({ id: follows.artistId }).from(follows).where(eq(follows.userId, user.id)),
      ]);
      return {
        likedTrackIds: liked.map((r) => r.id),
        followedArtistIds: followed.map((r) => r.id),
      } satisfies LibraryIds;
    });

    app.get("/me/likes", async (request) => {
      const user = await requireUser(db, request);
      const rows = await selectTrackSummariesWith(db, { likedAt: likes.createdAt })
        .innerJoin(likes, eq(likes.trackId, tracks.id))
        .where(and(eq(likes.userId, user.id), eq(tracks.status, "live")))
        .orderBy(desc(likes.createdAt));
      return rows.map((r) => ({ track: toTrackSummary(r), likedAt: r.likedAt.toISOString() })) satisfies LikedTrack[];
    });

    app.put<{ Params: { trackId: string } }>("/me/likes/:trackId", async (request, reply) => {
      const user = await requireUser(db, request);
      const trackId = z.uuid().parse(request.params.trackId);
      const [track] = await db
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(eq(tracks.id, trackId), eq(tracks.status, "live")))
        .limit(1);
      if (!track) throw new HttpError(404, "Track not found.");
      await db.insert(likes).values({ userId: user.id, trackId }).onConflictDoNothing();
      return reply.code(204).send();
    });

    app.delete<{ Params: { trackId: string } }>("/me/likes/:trackId", async (request, reply) => {
      const user = await requireUser(db, request);
      const trackId = z.uuid().parse(request.params.trackId);
      await db.delete(likes).where(and(eq(likes.userId, user.id), eq(likes.trackId, trackId)));
      return reply.code(204).send();
    });

    app.get("/me/follows", async (request) => {
      const user = await requireUser(db, request);
      const rows = await db
        .select({ artist: artists })
        .from(follows)
        .innerJoin(artists, eq(artists.id, follows.artistId))
        .where(eq(follows.userId, user.id))
        .orderBy(desc(follows.createdAt));
      return rows.map((r) => toArtist(r.artist)) satisfies Artist[];
    });

    app.put<{ Params: { artistId: string } }>("/me/follows/:artistId", async (request, reply) => {
      const user = await requireUser(db, request);
      const artistId = z.uuid().parse(request.params.artistId);
      const [artist] = await db.select({ id: artists.id }).from(artists).where(eq(artists.id, artistId)).limit(1);
      if (!artist) throw new HttpError(404, "Artist not found.");
      await db.insert(follows).values({ userId: user.id, artistId }).onConflictDoNothing();
      return reply.code(204).send();
    });

    app.delete<{ Params: { artistId: string } }>("/me/follows/:artistId", async (request, reply) => {
      const user = await requireUser(db, request);
      const artistId = z.uuid().parse(request.params.artistId);
      await db.delete(follows).where(and(eq(follows.userId, user.id), eq(follows.artistId, artistId)));
      return reply.code(204).send();
    });

    /** Recently played: each track once, most recent first. */
    app.get("/me/history", async (request) => {
      const user = await requireUser(db, request);
      const lastPlayed = max(plays.playedAt);
      const recent = await db
        .select({ trackId: plays.trackId, playedAt: lastPlayed })
        .from(plays)
        .where(eq(plays.userId, user.id))
        .groupBy(plays.trackId)
        .orderBy(desc(lastPlayed))
        .limit(HISTORY_LIMIT);
      if (recent.length === 0) return [] satisfies HistoryItem[];

      const rows = await selectTrackSummaries(db).where(
        and(
          inArray(
            tracks.id,
            recent.map((r) => r.trackId),
          ),
          eq(tracks.status, "live"),
        ),
      );
      const byId = new Map(rows.map((r) => [r.id, toTrackSummary(r)]));
      return recent
        .filter((r) => byId.has(r.trackId) && r.playedAt)
        .map((r) => ({
          track: byId.get(r.trackId)!,
          playedAt: new Date(r.playedAt!).toISOString(),
        })) satisfies HistoryItem[];
    });
  };
