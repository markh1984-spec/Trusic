import type { AdminAppeal } from "@trusic/client";
import { resolveAiScore } from "@trusic/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireAdmin } from "../auth";
import type { Db } from "../db/client";
import { appeals, tracks, users } from "../db/schema";
import { HttpError } from "../errors";
import { runPayouts } from "../payout-service";
import { loadTrackDetail, loadTrackSummaries, toAppeal } from "../views";

const ResolveBody = z.object({
  decision: z.enum(["upheld", "rejected"]),
  /** Optional: settle on a specific score instead of the default for the decision. */
  score: z.number().int().min(0).max(100).optional(),
  note: z.string().trim().max(2000).optional(),
});

const ReviewBody = z.object({
  score: z.number().int().min(0).max(100),
  note: z.string().trim().max(2000).optional(),
});

/** Apply a reviewer's score to a track. Review decisions override declaration and detection. */
async function applyReviewScore(db: Db, trackId: string, reviewScore: number) {
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
  if (!track) throw new HttpError(404, "Track not found.");
  const resolution = resolveAiScore({ declaredScore: track.declaredScore, detection: track.detection, reviewScore });
  await db
    .update(tracks)
    .set({ reviewScore, aiScore: resolution.score, scoreSource: resolution.source, flagged: resolution.flagged })
    .where(eq(tracks.id, trackId));
}

export const adminRoutes =
  ({ db, config }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Querystring: { status?: string } }>("/admin/appeals", async (request) => {
      await requireAdmin(db, request);
      const status = z.enum(["open", "upheld", "rejected"]).default("open").parse(request.query.status);
      const rows = await db
        .select({ appeal: appeals, openedBy: { id: users.id, email: users.email, displayName: users.displayName } })
        .from(appeals)
        .innerJoin(users, eq(users.id, appeals.openedByUserId))
        .where(eq(appeals.status, status))
        .orderBy(status === "open" ? appeals.createdAt : desc(appeals.resolvedAt));

      const trackIds = rows.map((r) => r.appeal.trackId);
      const summaries = await loadTrackSummaries(db, trackIds);
      const extras = trackIds.length
        ? await db
            .select({ id: tracks.id, declaredScore: tracks.declaredScore, detection: tracks.detection })
            .from(tracks)
            .where(inArray(tracks.id, trackIds))
        : [];
      const extraById = new Map(extras.map((e) => [e.id, e]));

      return rows
        .filter((r) => summaries.has(r.appeal.trackId))
        .map(({ appeal, openedBy }) => {
          const extra = extraById.get(appeal.trackId)!;
          const d = extra.detection;
          return {
            ...toAppeal(appeal),
            track: {
              ...summaries.get(appeal.trackId)!,
              declaredScore: extra.declaredScore,
              detection: d
                ? { detector: d.detector, verdict: d.verdict, confidence: d.confidence, evidence: d.evidence }
                : null,
            },
            openedBy,
          };
        }) satisfies AdminAppeal[];
    });

    /**
     * Upheld: the artist was right. By default the score goes back to what they declared.
     * Rejected: the current score stands, and is locked in by the review.
     */
    app.post<{ Params: { id: string } }>("/admin/appeals/:id/resolve", async (request) => {
      const admin = await requireAdmin(db, request);
      const body = ResolveBody.parse(request.body);
      const [appeal] = await db
        .select({ appeal: appeals, track: tracks })
        .from(appeals)
        .innerJoin(tracks, eq(tracks.id, appeals.trackId))
        .where(and(eq(appeals.id, z.uuid().parse(request.params.id)), eq(appeals.status, "open")))
        .limit(1);
      if (!appeal) throw new HttpError(404, "Open appeal not found.");

      const score = body.score ?? (body.decision === "upheld" ? appeal.track.declaredScore : appeal.track.aiScore);
      await applyReviewScore(db, appeal.track.id, score);
      const [updated] = await db
        .update(appeals)
        .set({
          status: body.decision,
          resolvedScore: score,
          resolutionNote: body.note ?? null,
          resolvedByUserId: admin.id,
          resolvedAt: new Date(),
        })
        .where(eq(appeals.id, appeal.appeal.id))
        .returning();
      return toAppeal(updated!);
    });

    /** Set a track's score directly, e.g. after a listener report or an audit. */
    app.post<{ Params: { id: string } }>("/admin/tracks/:id/review", async (request) => {
      const admin = await requireAdmin(db, request);
      const body = ReviewBody.parse(request.body);
      const trackId = z.uuid().parse(request.params.id);
      await applyReviewScore(db, trackId, body.score);
      return loadTrackDetail(db, trackId, admin);
    });

    app.post("/admin/payouts/run", async (request) => {
      await requireAdmin(db, request);
      const { period } = z.object({ period: z.string() }).parse(request.body);
      return runPayouts(db, period, config.currency);
    });
  };
