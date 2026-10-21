import { parseLyrics, type LyricsTrack, type TrackLyrics } from "@trusic/client";
import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { optionalUser, requireUser } from "../auth";
import type { Db } from "../db/client";
import { artists, trackLyrics, trackSplits, tracks } from "../db/schema";
import { HttpError } from "../errors";
import { selectTrackSummariesWith, toTrackSummary } from "../views";

const LyricsBody = z.object({
  format: z.enum(["plain", "synced"]),
  text: z.string(),
});

/**
 * Lyrics on covers aren't shown: the words belong to the original songwriters, and displaying them needs a lyric
 * licence (usually through LyricFind or Musixmatch) that Trusic doesn't have. See docs/PRODUCT.md.
 */
export const COVER_LYRICS_MESSAGE =
  "Lyrics can't be shown for covers yet. The words belong to the original songwriters, and showing them needs a lyric licence Trusic doesn't have.";

/** Who may edit a track's lyrics: whoever uploaded it, and everyone in its band split. */
async function lyricsRole(db: Db, trackId: string, userId: string): Promise<"uploader" | "split" | null> {
  const [row] = await db
    .select({ ownerUserId: artists.ownerUserId, splitUserId: trackSplits.userId })
    .from(tracks)
    .innerJoin(artists, eq(artists.id, tracks.artistId))
    .leftJoin(trackSplits, and(eq(trackSplits.trackId, tracks.id), eq(trackSplits.userId, userId)))
    .where(eq(tracks.id, trackId))
    .limit(1);
  if (!row) return null;
  if (row.ownerUserId === userId) return "uploader";
  return row.splitUserId ? "split" : null;
}

export async function loadLyrics(db: Db, trackId: string, viewer: { id: string } | null): Promise<TrackLyrics | null> {
  const [track] = await db
    .select({ status: tracks.status, credits: tracks.credits, lyrics: trackLyrics })
    .from(tracks)
    .leftJoin(trackLyrics, eq(trackLyrics.trackId, tracks.id))
    .where(eq(tracks.id, trackId))
    .limit(1);
  if (!track) return null;
  const canEdit = viewer ? (await lyricsRole(db, trackId, viewer.id)) !== null : false;
  if (track.status !== "live" && !canEdit) return null;

  const hidden = track.credits?.isCover ? "cover" : null;
  const stored = track.lyrics;
  // People who can edit always see what they entered, so they can fix or remove it.
  const visible = stored && (!hidden || canEdit);
  return {
    trackId,
    format: visible ? stored.format : null,
    lines: visible ? parseLyrics(stored.format, stored.text).lines : [],
    source: visible && canEdit ? stored.text : null,
    hidden: stored || canEdit ? hidden : null,
    canEdit,
    updatedAt: visible ? stored.updatedAt.toISOString() : null,
  };
}

export const lyricsRoutes =
  ({ db }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Params: { id: string } }>("/tracks/:id/lyrics", async (request) => {
      const viewer = await optionalUser(db, request);
      const lyrics = await loadLyrics(db, z.uuid().parse(request.params.id), viewer);
      if (!lyrics) throw new HttpError(404, "Track not found.");
      return lyrics;
    });

    app.put<{ Params: { id: string } }>("/tracks/:id/lyrics", async (request) => {
      const user = await requireUser(db, request);
      const trackId = z.uuid().parse(request.params.id);
      const track = await editableTrack(trackId, user.id);
      if (track.credits?.isCover) throw new HttpError(409, COVER_LYRICS_MESSAGE);

      const body = LyricsBody.parse(request.body);
      const parsed = parseLyrics(body.format, body.text);
      if (parsed.error) throw new HttpError(400, parsed.error);
      const last = parsed.lines[parsed.lines.length - 1]!.timeMs;
      // A second of slack for rounding.
      if (last !== null && last > track.durationMs + 1000) {
        throw new HttpError(400, "Some lines are timed after the end of the track. Check the times and try again.");
      }

      const text = body.text.replace(/\r\n?/g, "\n").trim();
      await db
        .insert(trackLyrics)
        .values({ trackId, format: body.format, text, updatedByUserId: user.id })
        .onConflictDoUpdate({
          target: trackLyrics.trackId,
          set: { format: body.format, text, updatedByUserId: user.id, updatedAt: new Date() },
        });
      return loadLyrics(db, trackId, user);
    });

    app.delete<{ Params: { id: string } }>("/tracks/:id/lyrics", async (request, reply) => {
      const user = await requireUser(db, request);
      const track = await editableTrack(z.uuid().parse(request.params.id), user.id);
      await db.delete(trackLyrics).where(eq(trackLyrics.trackId, track.id));
      return reply.code(204).send();
    });

    /** Every track the user can add lyrics to: ones they uploaded, and ones they're in the split for. */
    app.get("/me/lyrics", async (request) => {
      const user = await requireUser(db, request);
      const splitTrackIds = db
        .select({ id: trackSplits.trackId })
        .from(trackSplits)
        .where(eq(trackSplits.userId, user.id));
      const rows = await selectTrackSummariesWith(db, {
        ownerUserId: artists.ownerUserId,
        credits: tracks.credits,
        declaration: tracks.declaration,
        format: trackLyrics.format,
      })
        .leftJoin(trackLyrics, eq(trackLyrics.trackId, tracks.id))
        .where(
          and(ne(tracks.status, "removed"), or(eq(artists.ownerUserId, user.id), inArray(tracks.id, splitTrackIds))),
        )
        .orderBy(desc(tracks.createdAt));
      return rows.map((r): LyricsTrack => ({
        track: toTrackSummary(r),
        format: r.format,
        isCover: r.credits?.isCover ?? false,
        instrumental: r.declaration.stages.lyrics === "not_applicable",
        role: r.ownerUserId === user.id ? "uploader" : "split",
      }));
    });

    async function editableTrack(trackId: string, userId: string) {
      const [track] = await db
        .select({ id: tracks.id, status: tracks.status, credits: tracks.credits, durationMs: tracks.durationMs })
        .from(tracks)
        .where(eq(tracks.id, trackId))
        .limit(1);
      if (!track || track.status === "removed") throw new HttpError(404, "Track not found.");
      if (!(await lyricsRole(db, trackId, userId))) {
        throw new HttpError(403, "Only the person who uploaded this track and its band split can change its lyrics.");
      }
      return track;
    }
  };
