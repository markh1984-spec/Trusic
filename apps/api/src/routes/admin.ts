import type { AdminAppeal, AdminStrike, RightsSummary, StrikeResult, SuspendedAccount } from "@trusic/client";
import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app";
import { requireAdmin } from "../auth";
import { appeals, strikes, tracks, users } from "../db/schema";
import { HttpError } from "../errors";
import { finalizeRun, runPayouts } from "../payout-service";
import { applyReviewScore, issueStrike, loadStrikes, reinstate, toStrike } from "../strikes";
import { loadTrackDetail, loadTrackSummaries, toAppeal } from "../views";

const ResolveBody = z.object({
  decision: z.enum(["upheld", "rejected"]),
  /** Optional: settle on a specific score instead of the default for the decision. */
  score: z.number().int().min(0).max(100).optional(),
  note: z.string().trim().max(2000).optional(),
  /** Rejected because the artist declared less AI than they used: issue a strike and claw back. */
  strike: z.boolean().optional(),
});

const StrikeBody = z.object({
  score: z.number().int().min(1).max(100),
  reason: z.string().trim().min(5).max(2000),
});

const ReviewBody = z.object({
  score: z.number().int().min(0).max(100),
  note: z.string().trim().max(2000).optional(),
});

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
      if (body.strike && body.decision === "rejected") {
        await issueStrike(db, {
          trackId: appeal.track.id,
          correctedScore: score,
          reason: body.note || "Appeal rejected: the track has more AI than declared.",
          issuedByUserId: admin.id,
          currency: config.currency,
        });
      } else {
        await applyReviewScore(db, appeal.track.id, score);
      }
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

    /** A proven false declaration, found by an audit or a report rather than an appeal. */
    app.post<{ Params: { id: string } }>("/admin/tracks/:id/strike", async (request) => {
      const admin = await requireAdmin(db, request);
      const body = StrikeBody.parse(request.body);
      const trackId = z.uuid().parse(request.params.id);
      const outcome = await issueStrike(db, {
        trackId,
        correctedScore: body.score,
        reason: body.reason,
        issuedByUserId: admin.id,
        currency: config.currency,
      });
      const [track] = await db.select({ title: tracks.title }).from(tracks).where(eq(tracks.id, trackId)).limit(1);
      return {
        strike: toStrike(outcome.strike, track!.title),
        strikeCount: outcome.strikeCount,
        suspended: outcome.suspended,
      } satisfies StrikeResult;
    });

    /** How many live tracks involve collecting-society songwriters: the key number for a PRS licence. */
    app.get("/admin/rights-summary", async (request) => {
      await requireAdmin(db, request);
      const rows = await db.select({ credits: tracks.credits }).from(tracks).where(eq(tracks.status, "live"));
      const summary: RightsSummary = {
        totalTracks: rows.length,
        societyMember: { yes: 0, no: 0, unsure: 0, notGiven: 0 },
        covers: 0,
      };
      for (const { credits } of rows) {
        if (credits?.societyMember) summary.societyMember[credits.societyMember] += 1;
        else summary.societyMember.notGiven += 1;
        if (credits?.isCover) summary.covers += 1;
      }
      return summary;
    });

    app.get("/admin/strikes", async (request) => {
      await requireAdmin(db, request);
      return (await loadStrikes(db)).reverse() satisfies AdminStrike[];
    });

    app.get("/admin/suspended", async (request) => {
      await requireAdmin(db, request);
      const rows = await db
        .select({ user: users, strikes: count(strikes.id) })
        .from(users)
        .leftJoin(strikes, eq(strikes.userId, users.id))
        .where(isNotNull(users.suspendedAt))
        .groupBy(users.id);
      return rows.map((r) => ({
        id: r.user.id,
        email: r.user.email,
        displayName: r.user.displayName,
        suspendedAt: r.user.suspendedAt!.toISOString(),
        strikes: r.strikes,
      })) satisfies SuspendedAccount[];
    });

    app.post<{ Params: { id: string } }>("/admin/users/:id/reinstate", async (request, reply) => {
      await requireAdmin(db, request);
      await reinstate(db, z.uuid().parse(request.params.id));
      return reply.code(204).send();
    });

    app.post<{ Params: { period: string } }>("/admin/payouts/:period/finalize", async (request) => {
      await requireAdmin(db, request);
      return finalizeRun(db, request.params.period);
    });

    app.post("/admin/payouts/run", async (request) => {
      await requireAdmin(db, request);
      const { period } = z.object({ period: z.string() }).parse(request.body);
      return runPayouts(db, period, config.currency);
    });
  };
