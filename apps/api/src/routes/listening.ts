import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlayRecorded, StreamUrl } from "@trusic/client";
import { DEFAULT_PAYOUT_CONFIG } from "@trusic/core";
import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireUser } from "../auth";
import { plays, tracks } from "../db/schema";
import { HttpError } from "../errors";

const STREAM_URL_TTL_SECONDS = 6 * 60 * 60;

/**
 * Audio is fetched by <audio> elements, which can't send auth headers, so we
 * hand out short-lived signed URLs instead. The same scheme works for a CDN later.
 */
export function signStream(secret: string, trackId: string, expires: number): string {
  return createHmac("sha256", secret).update(`${trackId}.${expires}`).digest("base64url");
}

function verifyStream(secret: string, trackId: string, expires: number, sig: string): boolean {
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
  const expected = Buffer.from(signStream(secret, trackId, expires));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Parse a single-range `Range: bytes=...` header. Returns null if unsatisfiable. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

export const listeningRoutes =
  ({ db, storage, config }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Params: { id: string } }>("/tracks/:id/stream", async (request) => {
      await requireUser(db, request);
      const trackId = z.uuid().parse(request.params.id);
      const [track] = await db
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(eq(tracks.id, trackId), eq(tracks.status, "live")))
        .limit(1);
      if (!track) throw new HttpError(404, "Track not found.");

      const expires = Math.floor(Date.now() / 1000) + STREAM_URL_TTL_SECONDS;
      const sig = signStream(config.streamSigningSecret, track.id, expires);
      return {
        url: `/api/stream/${track.id}?expires=${expires}&sig=${sig}`,
        expiresAt: new Date(expires * 1000).toISOString(),
        preview: false,
        previewMs: null,
      } satisfies StreamUrl;
    });

    app.get<{ Params: { id: string }; Querystring: { expires?: string; sig?: string } }>(
      "/stream/:id",
      async (request, reply) => {
        const trackId = request.params.id;
        const expires = Number(request.query.expires);
        if (!verifyStream(config.streamSigningSecret, trackId, expires, request.query.sig ?? "")) {
          throw new HttpError(403, "This stream link has expired.");
        }
        const [track] = await db
          .select({ audioKey: tracks.audioKey, mime: tracks.audioMimeType })
          .from(tracks)
          .where(eq(tracks.id, trackId))
          .limit(1);
        if (!track) throw new HttpError(404, "Track not found.");

        const size = await storage.size(track.audioKey);
        reply
          .header("accept-ranges", "bytes")
          .header("content-type", track.mime)
          .header("cache-control", "private, max-age=3600");

        const rangeHeader = request.headers.range;
        if (rangeHeader) {
          const range = parseRange(rangeHeader, size);
          if (!range) return reply.code(416).header("content-range", `bytes */${size}`).send();
          return reply
            .code(206)
            .header("content-range", `bytes ${range.start}-${range.end}/${size}`)
            .header("content-length", range.end - range.start + 1)
            .send(storage.read(track.audioKey, range));
        }
        return reply.header("content-length", size).send(storage.read(track.audioKey));
      },
    );

    const PlayBody = z.object({
      trackId: z.uuid(),
      msPlayed: z.number().int().min(0),
    });

    /**
     * Clients report each listen once it ends (or is skipped). Listens of
     * 30 seconds or more count as streams in payouts.
     */
    app.post("/plays", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
      const user = await requireUser(db, request);
      const body = PlayBody.parse(request.body);
      const [track] = await db
        .select({ durationMs: tracks.durationMs, aiScore: tracks.aiScore })
        .from(tracks)
        .where(eq(tracks.id, body.trackId))
        .limit(1);
      if (!track) throw new HttpError(404, "Track not found.");

      // A play can't be longer than the track (small slack for clock jitter).
      const msPlayed = Math.min(body.msPlayed, track.durationMs + 2_000);
      await db.insert(plays).values({ userId: user.id, trackId: body.trackId, msPlayed, aiScore: track.aiScore });
      return reply.code(201).send({ counted: msPlayed >= DEFAULT_PAYOUT_CONFIG.minStreamMs } satisfies PlayRecorded);
    });
  };
