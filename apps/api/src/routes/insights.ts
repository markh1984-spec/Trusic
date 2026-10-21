import type { ArtistMoney, ArtistStats, StudioArtist, TrackStats } from "@trusic/client";
import { count, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireUser } from "../auth";
import { artists, likes, tracks } from "../db/schema";
import { HttpError } from "../errors";
import {
  artistMoney,
  artistTrackIds,
  listeningStats,
  statsRole,
  statsWindow,
  studioArtists,
  topTracks,
} from "../stats-service";
import { loadTrackSummaries } from "../views";

const RangeQuery = z.object({ range: z.enum(["7d", "28d", "365d"]).default("28d") });

const NOT_YOURS = "Only the artist and the band members in its splits can see these stats.";

/** "Trusic for Artists": stats and money for the artists a user owns or plays in. */
export const insightRoutes =
  ({ db, config }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.get("/studio/artists", async (request) => {
      const user = await requireUser(db, request);
      return (await studioArtists(db, user.id)) satisfies StudioArtist[];
    });

    /** Everyone with access sees the whole artist's listening; money is a separate call and always the viewer's own. */
    app.get<{ Params: { id: string } }>("/studio/artists/:id/stats", async (request) => {
      const user = await requireUser(db, request);
      const artistId = z.uuid().parse(request.params.id);
      const { range } = RangeQuery.parse(request.query);
      const role = await statsRole(db, artistId, user);
      if (!role) throw new HttpError(403, NOT_YOURS);

      const [artist] = await db
        .select({ id: artists.id, name: artists.name, slug: artists.slug })
        .from(artists)
        .where(eq(artists.id, artistId))
        .limit(1);
      const ids = await artistTrackIds(db, artistId);
      const [{ byTrack, ...stats }, summaries] = await Promise.all([
        listeningStats(db, ids, statsWindow(range), role, { artistId }),
        loadTrackSummaries(db, ids),
      ]);
      return { ...stats, artist: artist!, topTracks: topTracks(byTrack, summaries) } satisfies ArtistStats;
    });

    app.get<{ Params: { id: string } }>("/studio/artists/:id/money", async (request) => {
      const user = await requireUser(db, request);
      const artistId = z.uuid().parse(request.params.id);
      if (!(await statsRole(db, artistId, user))) throw new HttpError(403, NOT_YOURS);
      return (await artistMoney(db, artistId, user.id, config.currency)) satisfies ArtistMoney;
    });

    /** The same stats for one track, plus the viewer's money from it. */
    app.get<{ Params: { id: string } }>("/studio/tracks/:id/stats", async (request) => {
      const user = await requireUser(db, request);
      const trackId = z.uuid().parse(request.params.id);
      const { range } = RangeQuery.parse(request.query);
      const [row] = await db.select({ artistId: tracks.artistId }).from(tracks).where(eq(tracks.id, trackId)).limit(1);
      if (!row) throw new HttpError(404, "Track not found.");
      const role = await statsRole(db, row.artistId, user);
      if (!role) throw new HttpError(403, NOT_YOURS);

      // A taken-down track's plays stop counting, as in payouts; its money from past months still shows.
      const counted = await artistTrackIds(db, row.artistId, trackId);
      const window = statsWindow(range);
      const [stats, summaries, [liked], money] = await Promise.all([
        listeningStats(db, counted, window, role),
        loadTrackSummaries(db, [trackId]),
        db.select({ n: count() }).from(likes).where(eq(likes.trackId, trackId)),
        artistMoney(db, row.artistId, user.id, config.currency, trackId),
      ]);
      const { followers: _artists, followersGained: _only, followersLost: _too, byTrack: _oneTrack, ...rest } = stats;
      return { ...rest, track: summaries.get(trackId)!, likesTotal: liked?.n ?? 0, money } satisfies TrackStats;
    });
  };
