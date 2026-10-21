import type { UploadInProgress, UploadStatus } from "@trusic/client";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireUser } from "../auth";
import { artists, tracks, type ImageVariant } from "../db/schema";
import { HttpError } from "../errors";
import { IMAGE_MIME_BY_EXT } from "../uploads";

const FAILED_MESSAGE =
  "We couldn't prepare this file for streaming. Try exporting it again as WAV, FLAC or MP3, then upload it again.";

const IMMUTABLE = "public, max-age=31536000, immutable";

/** The smallest copy at least `size` pixels across, or the largest if none is (or no size was asked for). */
export function pickVariant(variants: ImageVariant[], size: number | null): ImageVariant {
  const sorted = [...variants].sort((a, b) => a.size - b.size);
  return (size === null ? undefined : sorted.find((v) => v.size >= size)) ?? sorted[sorted.length - 1]!;
}

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
          createdAt: tracks.createdAt,
          artistId: artists.id,
          artistName: artists.name,
          artistSlug: artists.slug,
        })
        .from(tracks)
        .innerJoin(artists, eq(artists.id, tracks.artistId))
        .where(and(eq(artists.ownerUserId, user.id), inArray(tracks.status, ["processing", "failed"])))
        .orderBy(desc(tracks.createdAt));
      return rows.map((r): UploadInProgress => ({
        track: { id: r.id, title: r.title },
        artist: { id: r.artistId, name: r.artistName, slug: r.artistSlug },
        status: r.status as UploadStatus,
        message: r.status === "failed" ? FAILED_MESSAGE : null,
        uploadedAt: r.createdAt.toISOString(),
      }));
    });

    /**
     * Images are public and never change (each upload gets a new name), so they're cached forever. `?size=` picks
     * one of the resized copies (see IMAGE_SIZES); without it, the largest. Until the copies are made, or if they
     * can't be, the upload itself is sent.
     */
    app.get<{ Params: { name: string }; Querystring: { size?: string } }>("/images/:name", async (request, reply) => {
      const m = /^[0-9a-f-]{36}\.(png|jpg|webp)$/.exec(request.params.name);
      if (!m) throw new HttpError(404, "Image not found.");
      const key = `images/${request.params.name}`;
      const size = request.query.size ? z.coerce.number().int().min(1).max(4096).parse(request.query.size) : null;

      const { variants, pending } = await media.imageVariants(key);
      if (variants) {
        const variant = pickVariant(variants, size);
        return reply
          .header("content-type", variant.mime)
          .header("content-length", variant.bytes)
          .header("cache-control", IMMUTABLE)
          .send(storage.read(variant.key));
      }
      const bytes = await storage.size(key).catch(() => null);
      if (bytes === null) throw new HttpError(404, "Image not found.");
      return (
        reply
          .header("content-type", IMAGE_MIME_BY_EXT[m[1]!]!)
          .header("content-length", bytes)
          // Smaller copies are on their way, so don't keep this one for long.
          .header("cache-control", pending ? "public, max-age=60" : IMMUTABLE)
          .send(storage.read(key))
      );
    });
  };
