import type { Artist } from "@trusic/client";
import { and, desc, eq, like } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireUser } from "../auth";
import type { Db } from "../db/client";
import { artists, tracks } from "../db/schema";
import { HttpError } from "../errors";
import { selectTrackSummaries, toArtist, toTrackSummary } from "../views";

const ArtistBody = z.object({
  name: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(2000).optional(),
});

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "artist";
}

async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set(
    (
      await db
        .select({ slug: artists.slug })
        .from(artists)
        .where(like(artists.slug, `${base}%`))
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export const artistRoutes =
  ({ db }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.post("/artists", async (request, reply) => {
      const user = await requireUser(db, request);
      const body = ArtistBody.parse(request.body);
      const [artist] = await db
        .insert(artists)
        .values({ ownerUserId: user.id, name: body.name, bio: body.bio ?? "", slug: await uniqueSlug(db, body.name) })
        .returning();
      return reply.code(201).send(toArtist(artist!) satisfies Artist);
    });

    app.patch<{ Params: { id: string } }>("/artists/:id", async (request) => {
      const user = await requireUser(db, request);
      const body = ArtistBody.partial().parse(request.body);
      const [artist] = await db
        .update(artists)
        .set({ ...(body.name ? { name: body.name } : {}), ...(body.bio !== undefined ? { bio: body.bio } : {}) })
        .where(and(eq(artists.id, z.uuid().parse(request.params.id)), eq(artists.ownerUserId, user.id)))
        .returning();
      if (!artist) throw new HttpError(404, "Artist not found.");
      return toArtist(artist);
    });

    app.get<{ Params: { slug: string } }>("/artists/:slug", async (request) => {
      const [artist] = await db.select().from(artists).where(eq(artists.slug, request.params.slug)).limit(1);
      if (!artist) throw new HttpError(404, "Artist not found.");
      const rows = await selectTrackSummaries(db)
        .where(and(eq(tracks.artistId, artist.id), eq(tracks.status, "live")))
        .orderBy(desc(tracks.createdAt));
      return { artist: toArtist(artist), tracks: rows.map(toTrackSummary) };
    });
  };
