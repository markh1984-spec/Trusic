import type { PlaylistDetail, PlaylistSummary } from "@trusic/client";
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { optionalUser, requireUser } from "../auth";
import type { Db } from "../db/client";
import { playlistEntries, playlists, releases, tracks, users } from "../db/schema";
import { HttpError } from "../errors";
import { imageUrl } from "../uploads";
import { selectTrackSummariesWith, toTrackSummary } from "../views";

const MAX_ENTRIES = 10_000;

const PlaylistBody = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).optional(),
  isPublic: z.boolean().optional(),
});

const AddEntries = z.object({ trackIds: z.array(z.uuid()).min(1).max(500) });
const Reorder = z.object({ entryIds: z.array(z.uuid()) });

/** Summaries for the given playlists, with live-track counts and up to four cover images. */
async function loadPlaylistSummaries(db: Db, ids: string[]): Promise<PlaylistSummary[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ playlist: playlists, ownerName: users.displayName })
    .from(playlists)
    .innerJoin(users, eq(users.id, playlists.ownerUserId))
    .where(inArray(playlists.id, ids))
    .orderBy(desc(playlists.updatedAt));

  const entries = await db
    .select({ playlistId: playlistEntries.playlistId, artworkKey: releases.artworkKey })
    .from(playlistEntries)
    .innerJoin(tracks, eq(tracks.id, playlistEntries.trackId))
    .leftJoin(releases, eq(releases.id, tracks.releaseId))
    .where(and(inArray(playlistEntries.playlistId, ids), eq(tracks.status, "live")))
    .orderBy(asc(playlistEntries.position));

  const stats = new Map<string, { count: number; artwork: string[] }>();
  for (const e of entries) {
    const s = stats.get(e.playlistId) ?? { count: 0, artwork: [] };
    s.count += 1;
    const url = imageUrl(e.artworkKey);
    if (url && s.artwork.length < 4 && !s.artwork.includes(url)) s.artwork.push(url);
    stats.set(e.playlistId, s);
  }

  return rows.map(({ playlist: p, ownerName }) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    isPublic: p.isPublic,
    owner: { id: p.ownerUserId, displayName: ownerName },
    trackCount: stats.get(p.id)?.count ?? 0,
    artworkUrls: stats.get(p.id)?.artwork ?? [],
    updatedAt: p.updatedAt.toISOString(),
  }));
}

export async function loadPlaylistDetail(
  db: Db,
  playlistId: string,
  viewer: { id: string } | null,
): Promise<PlaylistDetail | null> {
  const [summary] = await loadPlaylistSummaries(db, [playlistId]);
  if (!summary) return null;
  const isOwner = viewer?.id === summary.owner.id;
  if (!summary.isPublic && !isOwner) return null;

  const rows = await selectTrackSummariesWith(db, {
    entryId: playlistEntries.id,
    addedAt: playlistEntries.addedAt,
  })
    .innerJoin(playlistEntries, eq(playlistEntries.trackId, tracks.id))
    .where(and(eq(playlistEntries.playlistId, playlistId), eq(tracks.status, "live")))
    .orderBy(asc(playlistEntries.position));
  const entries = rows.map((r) => ({
    entryId: r.entryId,
    addedAt: r.addedAt.toISOString(),
    track: toTrackSummary(r),
  }));
  return {
    ...summary,
    entries,
    durationMs: entries.reduce((acc, e) => acc + e.track.durationMs, 0),
    isOwner,
  };
}

export const playlistRoutes =
  ({ db }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    async function ownedPlaylist(playlistId: string, userId: string) {
      const [row] = await db
        .select()
        .from(playlists)
        .where(and(eq(playlists.id, playlistId), eq(playlists.ownerUserId, userId)))
        .limit(1);
      if (!row) throw new HttpError(404, "Playlist not found.");
      return row;
    }

    const touch = (playlistId: string) =>
      db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId));

    app.get("/me/playlists", async (request) => {
      const user = await requireUser(db, request);
      const mine = await db.select({ id: playlists.id }).from(playlists).where(eq(playlists.ownerUserId, user.id));
      return loadPlaylistSummaries(
        db,
        mine.map((p) => p.id),
      );
    });

    app.post("/playlists", async (request, reply) => {
      const user = await requireUser(db, request);
      const body = PlaylistBody.parse(request.body);
      const [playlist] = await db
        .insert(playlists)
        .values({
          ownerUserId: user.id,
          name: body.name,
          description: body.description ?? "",
          isPublic: body.isPublic ?? true,
        })
        .returning({ id: playlists.id });
      return reply.code(201).send(await loadPlaylistDetail(db, playlist!.id, user));
    });

    app.get<{ Params: { id: string } }>("/playlists/:id", async (request) => {
      const viewer = await optionalUser(db, request);
      const detail = await loadPlaylistDetail(db, z.uuid().parse(request.params.id), viewer);
      if (!detail) throw new HttpError(404, "Playlist not found.");
      return detail;
    });

    app.patch<{ Params: { id: string } }>("/playlists/:id", async (request) => {
      const user = await requireUser(db, request);
      const playlist = await ownedPlaylist(z.uuid().parse(request.params.id), user.id);
      const body = PlaylistBody.partial().parse(request.body);
      await db
        .update(playlists)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}),
          updatedAt: new Date(),
        })
        .where(eq(playlists.id, playlist.id));
      return loadPlaylistDetail(db, playlist.id, user);
    });

    app.delete<{ Params: { id: string } }>("/playlists/:id", async (request, reply) => {
      const user = await requireUser(db, request);
      const playlist = await ownedPlaylist(z.uuid().parse(request.params.id), user.id);
      await db.delete(playlists).where(eq(playlists.id, playlist.id));
      return reply.code(204).send();
    });

    app.post<{ Params: { id: string } }>("/playlists/:id/entries", async (request) => {
      const user = await requireUser(db, request);
      const playlist = await ownedPlaylist(z.uuid().parse(request.params.id), user.id);
      const { trackIds } = AddEntries.parse(request.body);

      const found = await db
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(inArray(tracks.id, [...new Set(trackIds)]), eq(tracks.status, "live")));
      if (found.length !== new Set(trackIds).size) throw new HttpError(400, "Some of those tracks aren't available.");

      await db.transaction(async (tx) => {
        const [stats] = await tx
          .select({ n: count(), last: max(playlistEntries.position) })
          .from(playlistEntries)
          .where(eq(playlistEntries.playlistId, playlist.id));
        if ((stats?.n ?? 0) + trackIds.length > MAX_ENTRIES) {
          throw new HttpError(400, `Playlists can hold up to ${MAX_ENTRIES.toLocaleString("en-GB")} tracks.`);
        }
        const start = (stats?.last ?? 0) + 1;
        await tx
          .insert(playlistEntries)
          .values(trackIds.map((trackId, i) => ({ playlistId: playlist.id, trackId, position: start + i })));
      });
      await touch(playlist.id);
      return loadPlaylistDetail(db, playlist.id, user);
    });

    app.delete<{ Params: { id: string; entryId: string } }>("/playlists/:id/entries/:entryId", async (request) => {
      const user = await requireUser(db, request);
      const playlist = await ownedPlaylist(z.uuid().parse(request.params.id), user.id);
      const entryId = z.uuid().parse(request.params.entryId);
      const deleted = await db
        .delete(playlistEntries)
        .where(and(eq(playlistEntries.id, entryId), eq(playlistEntries.playlistId, playlist.id)))
        .returning({ id: playlistEntries.id });
      if (deleted.length === 0) throw new HttpError(404, "That track isn't in this playlist.");
      await touch(playlist.id);
      return loadPlaylistDetail(db, playlist.id, user);
    });

    /**
     * Reorder: send every visible entry in its new order. Entries for tracks that
     * have since been removed are hidden from listeners, so they go to the end.
     */
    app.put<{ Params: { id: string } }>("/playlists/:id/order", async (request) => {
      const user = await requireUser(db, request);
      const playlist = await ownedPlaylist(z.uuid().parse(request.params.id), user.id);
      const { entryIds } = Reorder.parse(request.body);

      const all = await db
        .select({ id: playlistEntries.id, status: tracks.status })
        .from(playlistEntries)
        .innerJoin(tracks, eq(tracks.id, playlistEntries.trackId))
        .where(eq(playlistEntries.playlistId, playlist.id))
        .orderBy(asc(playlistEntries.position));
      const visible = all.filter((e) => e.status === "live").map((e) => e.id);
      const sameSet = entryIds.length === visible.length && new Set(entryIds).size === entryIds.length;
      if (!sameSet || !entryIds.every((id) => visible.includes(id))) {
        throw new HttpError(400, "Send every track in the playlist exactly once, in the new order.");
      }

      const order = [...entryIds, ...all.filter((e) => e.status !== "live").map((e) => e.id)];
      await db.transaction(async (tx) => {
        for (const [i, id] of order.entries()) {
          await tx
            .update(playlistEntries)
            .set({ position: i + 1 })
            .where(eq(playlistEntries.id, id));
        }
      });
      await touch(playlist.id);
      return loadPlaylistDetail(db, playlist.id, user);
    });
  };
