import type { HomeFeed, HumanOnlySetting, RadioBatch, SimilarArtists, SimilarTracks } from "@trusic/client";
import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireUser } from "../auth";
import { tracks, users } from "../db/schema";
import { HttpError } from "../errors";
import { humanOnlySetting, resolveHumanOnly } from "../human-only";
import { homeFeed, radioBatch, similarArtists, similarTracks } from "../recommendations";
import { selectTrackSummaries, toTrackSummary } from "../views";

const RadioQuery = z.object({
  seed: z
    .string()
    .regex(/^(track|artist|playlist):[0-9a-f-]{36}$/i, "seed must look like track:<id>, artist:<id> or playlist:<id>")
    .transform((s) => {
      const [type, id] = s.split(":") as ["track" | "artist" | "playlist", string];
      return { type, id: id.toLowerCase() };
    }),
  /** What the station has played so far, oldest first. Only the most recent 200 matter. */
  exclude: z
    .string()
    .max(40 * 400)
    .optional()
    .transform((s) =>
      (s ?? "")
        .split(",")
        .filter((id) => z.uuid().safeParse(id).success)
        .slice(-200),
    ),
  limit: z.coerce.number().int().min(1).max(30).default(10),
});

const FAIR = "Nobody can pay to be here, and no AI label gets a boost.";
const HUMAN_ONLY_NOTE = "Human-made only is on, so tracks labelled Partly AI and AI Slop are left out.";
const withNote = (text: string, humanOnly: boolean) => (humanOnly ? `${text} ${HUMAN_ONLY_NOTE}` : text);

/** Recommendations, radio and the "Human-made only" setting. */
export const recommendationRoutes =
  ({ db }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.get("/me/human-only", async (request) => {
      const user = await requireUser(db, request);
      return { humanOnly: await humanOnlySetting(db, user.id) } satisfies HumanOnlySetting;
    });

    app.put("/me/human-only", async (request) => {
      const user = await requireUser(db, request);
      const { humanOnly } = z.object({ humanOnly: z.boolean() }).parse(request.body);
      await db.update(users).set({ humanOnly }).where(eq(users.id, user.id));
      return { humanOnly } satisfies HumanOnlySetting;
    });

    app.get("/recommendations/home", async (request) => {
      const { humanOnly, user } = await resolveHumanOnly(db, request);
      return (await homeFeed(db, user?.id ?? null, humanOnly)) satisfies HomeFeed;
    });

    /** "More like this" on a track page. */
    app.get<{ Params: { id: string } }>("/recommendations/tracks/:id", async (request) => {
      const id = z.uuid().parse(request.params.id);
      const { humanOnly, user } = await resolveHumanOnly(db, request);
      const [row] = await selectTrackSummaries(db)
        .where(and(eq(tracks.id, id), eq(tracks.status, "live")))
        .limit(1);
      if (!row) throw new HttpError(404, "Track not found.");
      const track = toTrackSummary(row);
      return {
        why: withNote(
          `Tracks streamed and liked by the same people as ${track.title}, then more from the same artist and genre. ${FAIR}`,
          humanOnly,
        ),
        humanOnly,
        tracks: await similarTracks(db, [track], { humanOnly, viewerId: user?.id, limit: 10 }),
      } satisfies SimilarTracks;
    });

    /** "Fans also like" on an artist page. */
    app.get<{ Params: { id: string } }>("/recommendations/artists/:id", async (request) => {
      const id = z.uuid().parse(request.params.id);
      const { humanOnly, user } = await resolveHumanOnly(db, request);
      return {
        why: withNote(
          `Artists whose music is streamed and liked by the same people, then artists in the same genres. ${FAIR}`,
          humanOnly,
        ),
        humanOnly,
        artists: await similarArtists(db, id, { humanOnly, viewerId: user?.id }),
      } satisfies SimilarArtists;
    });

    /** The next tracks for a radio station started from a track, an artist or a playlist. Visitors hear previews. */
    app.get("/radio", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => {
      const query = RadioQuery.parse(request.query);
      const { humanOnly, user } = await resolveHumanOnly(db, request);
      return (await radioBatch(db, query.seed, {
        exclude: query.exclude,
        limit: query.limit,
        humanOnly,
        viewerId: user?.id ?? null,
      })) satisfies RadioBatch;
    });
  };
