import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { RubricInfo, Split, TrackList } from "@trusic/client";
import {
  AI_LABEL_RANGES,
  AI_LABELS,
  ASSISTIVE_TOOLS,
  DEFAULT_RUBRIC,
  DEFAULT_SCORE_POLICY,
  InvalidDeclarationError,
  parseAiDeclaration,
  resolveAiScore,
  scoreDeclaration,
} from "@trusic/core";
import { and, count, desc, eq, gte, ilike, inArray, lt, or, type SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { parseFile, type IAudioMetadata } from "music-metadata";
import { z } from "zod";
import type { AppDeps } from "../app";
import { optionalUser, requireUser } from "../auth";
import { appeals, artists, trackSplits, tracks, users } from "../db/schema";
import { HttpError } from "../errors";
import { isArtistOwner, loadTrackDetail, selectTrackSummaries, toAppeal, toTrackSummary } from "../views";

const UploadFields = z.object({
  artistId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  genre: z.string().trim().max(60).optional(),
  declaration: z.string().min(2),
});

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  label: z.enum(["human", "ai_assisted", "ai_generated"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const SplitsBody = z.object({
  splits: z
    .array(z.object({ email: z.email(), shareBps: z.number().int().min(1).max(10_000) }))
    .min(1)
    .max(20),
});

/** Containers we accept, and how we serve them. */
const AUDIO_FORMATS: Record<string, { mime: string; ext: string }> = {
  MPEG: { mime: "audio/mpeg", ext: ".mp3" },
  FLAC: { mime: "audio/flac", ext: ".flac" },
  WAVE: { mime: "audio/wav", ext: ".wav" },
  Ogg: { mime: "audio/ogg", ext: ".ogg" },
  AIFF: { mime: "audio/aiff", ext: ".aiff" },
  "M4A/isom/iso2": { mime: "audio/mp4", ext: ".m4a" },
  "M4A/mp42/isom": { mime: "audio/mp4", ext: ".m4a" },
  "M4A/M4A/mp42/isom": { mime: "audio/mp4", ext: ".m4a" },
};

function audioFormat(metadata: IAudioMetadata) {
  const container = metadata.format.container ?? "";
  return AUDIO_FORMATS[container] ?? (container.startsWith("M4A") ? { mime: "audio/mp4", ext: ".m4a" } : null);
}

export const trackRoutes =
  ({ db, storage, detector }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.get("/rubric", async () => {
      return {
        rubric: DEFAULT_RUBRIC,
        assistiveTools: [...ASSISTIVE_TOOLS],
        labels: AI_LABELS,
        scorePolicy: DEFAULT_SCORE_POLICY,
      } satisfies RubricInfo;
    });

    app.get("/tracks", async (request) => {
      const query = ListQuery.parse(request.query);
      const filters: SQL[] = [eq(tracks.status, "live")];
      if (query.q) {
        const pattern = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        filters.push(or(ilike(tracks.title, pattern), ilike(artists.name, pattern), ilike(tracks.genre, pattern))!);
      }
      if (query.label) {
        const { min, max } = AI_LABEL_RANGES[query.label];
        filters.push(gte(tracks.aiScore, min), lt(tracks.aiScore, max));
      }
      const where = and(...filters);
      const [rows, [total]] = await Promise.all([
        selectTrackSummaries(db).where(where).orderBy(desc(tracks.createdAt)).limit(query.limit).offset(query.offset),
        db.select({ n: count() }).from(tracks).innerJoin(artists, eq(artists.id, tracks.artistId)).where(where),
      ]);
      return { tracks: rows.map(toTrackSummary), total: total?.n ?? 0 } satisfies TrackList;
    });

    app.get<{ Params: { id: string } }>("/tracks/:id", async (request) => {
      const id = z.uuid().parse(request.params.id);
      const viewer = await optionalUser(db, request);
      const detail = await loadTrackDetail(db, id, viewer);
      if (!detail) throw new HttpError(404, "Track not found.");
      return detail;
    });

    app.post("/tracks", async (request, reply) => {
      const user = await requireUser(db, request);
      const fields: Record<string, string> = {};
      let tempPath: string | null = null;

      try {
        for await (const part of request.parts()) {
          if (part.type === "file") {
            if (part.fieldname !== "audio" || tempPath) {
              part.file.resume();
              throw new HttpError(400, 'Send exactly one audio file, in a field named "audio".');
            }
            tempPath = await storage.tempPath();
            await pipeline(part.file, createWriteStream(tempPath));
            if (part.file.truncated) throw new HttpError(413, "That file is too large.");
          } else {
            fields[part.fieldname] = String(part.value);
          }
        }
        if (!tempPath) throw new HttpError(400, 'Attach the audio file in a field named "audio".');

        const input = UploadFields.parse(fields);
        if (!(await isArtistOwner(db, input.artistId, user.id))) {
          throw new HttpError(403, "You can only upload to your own artist profiles.");
        }

        let declarationJson: unknown;
        try {
          declarationJson = JSON.parse(input.declaration);
        } catch {
          throw new InvalidDeclarationError("declaration must be JSON");
        }
        const declaration = parseAiDeclaration(declarationJson);
        const breakdown = scoreDeclaration(declaration);

        const metadata = await parseFile(tempPath, { duration: true }).catch(() => null);
        const format = metadata && audioFormat(metadata);
        const durationSec = metadata?.format.duration;
        if (!metadata || !format || !durationSec) {
          throw new HttpError(415, "That doesn't look like an audio file we support (MP3, FLAC, WAV, OGG, AIFF, M4A).");
        }
        if (durationSec < 5 || durationSec > 60 * 60) {
          throw new HttpError(400, "Tracks must be between 5 seconds and 60 minutes long.");
        }

        const detection = await detector.analyze({ filePath: tempPath, metadata });
        const resolution = resolveAiScore({ declaredScore: breakdown.score, detection });

        const trackId = randomUUID();
        const audioKey = `tracks/${trackId}${format.ext}`;
        await storage.save(audioKey, tempPath);
        tempPath = null;
        const row: typeof tracks.$inferInsert = {
          id: trackId,
          artistId: input.artistId,
          title: input.title,
          genre: input.genre || null,
          durationMs: Math.round(durationSec * 1000),
          audioKey,
          audioMimeType: format.mime,
          audioBytes: await storage.size(audioKey),
          declaration,
          declaredScore: breakdown.score,
          rubricVersion: breakdown.rubricVersion,
          detection,
          aiScore: resolution.score,
          scoreSource: resolution.source,
          flagged: resolution.flagged,
        };

        try {
          await db.transaction(async (tx) => {
            await tx.insert(tracks).values(row);
            // The uploader is paid 100% until they set up band splits.
            await tx.insert(trackSplits).values({ trackId, userId: user.id, shareBps: 10_000 });
          });
        } catch (error) {
          await storage.remove(audioKey);
          throw error;
        }
        return reply.code(201).send(await loadTrackDetail(db, trackId, user));
      } finally {
        if (tempPath) await rm(tempPath, { force: true });
      }
    });

    app.delete<{ Params: { id: string } }>("/tracks/:id", async (request, reply) => {
      const user = await requireUser(db, request);
      const track = await ownedTrack(z.uuid().parse(request.params.id), user.id);
      // Keep the row: past statements and payouts still refer to it.
      await db.update(tracks).set({ status: "removed" }).where(eq(tracks.id, track.id));
      return reply.code(204).send();
    });

    app.get<{ Params: { id: string } }>("/tracks/:id/splits", async (request) => {
      const user = await requireUser(db, request);
      const track = await ownedTrack(z.uuid().parse(request.params.id), user.id);
      return loadSplits(track.id);
    });

    app.put<{ Params: { id: string } }>("/tracks/:id/splits", async (request) => {
      const user = await requireUser(db, request);
      const track = await ownedTrack(z.uuid().parse(request.params.id), user.id);
      const { splits } = SplitsBody.parse(request.body);

      const total = splits.reduce((acc, s) => acc + s.shareBps, 0);
      if (total !== 10_000) throw new HttpError(400, `Splits must add up to 100% (they add up to ${total / 100}%).`);
      const emails = splits.map((s) => s.email.toLowerCase());
      if (new Set(emails).size !== emails.length) throw new HttpError(400, "Each person can only appear once.");

      const members = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.email, emails));
      const idByEmail = new Map(members.map((m) => [m.email, m.id]));
      const missing = emails.filter((e) => !idByEmail.has(e));
      if (missing.length) {
        throw new HttpError(400, `Everyone in a split needs a Trusic account. Not found: ${missing.join(", ")}`);
      }

      await db.transaction(async (tx) => {
        await tx.delete(trackSplits).where(eq(trackSplits.trackId, track.id));
        await tx.insert(trackSplits).values(
          splits.map((s) => ({
            trackId: track.id,
            userId: idByEmail.get(s.email.toLowerCase())!,
            shareBps: s.shareBps,
          })),
        );
      });
      return loadSplits(track.id);
    });

    app.post<{ Params: { id: string } }>("/tracks/:id/appeals", async (request, reply) => {
      const user = await requireUser(db, request);
      const track = await ownedTrack(z.uuid().parse(request.params.id), user.id);
      const { message } = z.object({ message: z.string().trim().min(10).max(4000) }).parse(request.body);

      const [open] = await db
        .select({ id: appeals.id })
        .from(appeals)
        .where(and(eq(appeals.trackId, track.id), eq(appeals.status, "open")))
        .limit(1);
      if (open) throw new HttpError(409, "This track already has an open appeal.");

      const [appeal] = await db
        .insert(appeals)
        .values({ trackId: track.id, openedByUserId: user.id, message })
        .returning();
      return reply.code(201).send(toAppeal(appeal!));
    });

    async function ownedTrack(trackId: string, userId: string) {
      const [row] = await db
        .select({ id: tracks.id, status: tracks.status })
        .from(tracks)
        .innerJoin(artists, eq(artists.id, tracks.artistId))
        .where(and(eq(tracks.id, trackId), eq(artists.ownerUserId, userId)))
        .limit(1);
      if (!row) throw new HttpError(404, "Track not found.");
      return row;
    }

    async function loadSplits(trackId: string): Promise<Split[]> {
      const rows = await db
        .select({
          userId: users.id,
          email: users.email,
          displayName: users.displayName,
          shareBps: trackSplits.shareBps,
        })
        .from(trackSplits)
        .innerJoin(users, eq(users.id, trackSplits.userId))
        .where(eq(trackSplits.trackId, trackId))
        .orderBy(desc(trackSplits.shareBps));
      return rows;
    }
  };
