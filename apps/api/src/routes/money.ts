import type { Balance, EarningsPeriod, ListenerStatementView, Transparency } from "@trusic/client";
import { aiLabel, DEFAULT_PAYOUT_CONFIG, type AiLabel, type HumanPotReason } from "@trusic/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { AppDeps } from "../app";
import { requireUser } from "../auth";
import {
  ledgerEntries,
  payoutListenerStatements,
  payoutPayeeLines,
  payoutRuns,
  payoutTrackLines,
  revenueEntries,
  tracks,
  users,
} from "../db/schema";
import { currentPeriod, runSummaries } from "../payout-service";
import { loadStrikes } from "../strikes";
import { loadTrackSummaries, toUser } from "../views";

export const moneyRoutes =
  ({ db, config }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /** "Where did my money go?" One statement per month the listener paid for. */
    app.get("/me/statements", async (request) => {
      const user = await requireUser(db, request);
      const rows = await db
        .select({ statement: payoutListenerStatements, period: payoutRuns.period, currency: payoutRuns.currency })
        .from(payoutListenerStatements)
        .innerJoin(payoutRuns, eq(payoutRuns.id, payoutListenerStatements.runId))
        .where(eq(payoutListenerStatements.userId, user.id))
        .orderBy(desc(payoutRuns.period));

      const summaries = await loadTrackSummaries(
        db,
        rows.flatMap((r) => r.statement.allocations.map((a) => a.trackId)),
      );
      return rows.map(({ statement: s, period, currency }) => ({
        period,
        currency,
        revenue: s.revenue,
        platform: s.platform,
        artistShare: s.artistShare,
        allocations: s.allocations
          .filter((a) => summaries.has(a.trackId))
          .map((a) => ({
            track: summaries.get(a.trackId)!,
            streams: a.streams,
            baseAmount: a.baseAmount,
            amount: a.amount,
          }))
          .sort((a, b) => b.amount - a.amount || b.streams - a.streams),
        toHumanPot: s.toHumanPot as { amount: number; reason: HumanPotReason } | null,
      })) satisfies ListenerStatementView[];
    });

    /** What an artist (or band member) earned, month by month and track by track. */
    app.get("/me/earnings", async (request) => {
      const user = await requireUser(db, request);
      const rows = await db
        .select({ line: payoutPayeeLines, period: payoutRuns.period, currency: payoutRuns.currency })
        .from(payoutPayeeLines)
        .innerJoin(payoutRuns, eq(payoutRuns.id, payoutPayeeLines.runId))
        .where(eq(payoutPayeeLines.userId, user.id))
        .orderBy(desc(payoutRuns.period));
      if (rows.length === 0) return [] satisfies EarningsPeriod[];

      const trackLines = await db
        .select()
        .from(payoutTrackLines)
        .where(
          and(
            inArray(
              payoutTrackLines.runId,
              rows.map((r) => r.line.runId),
            ),
            inArray(
              payoutTrackLines.trackId,
              rows.flatMap((r) => r.line.tracks.map((t) => t.trackId)),
            ),
          ),
        );
      const lineKey = (runId: string, trackId: string) => `${runId}:${trackId}`;
      const linesByKey = new Map(trackLines.map((l) => [lineKey(l.runId, l.trackId), l]));
      const summaries = await loadTrackSummaries(
        db,
        trackLines.map((l) => l.trackId),
      );

      return rows.map(({ line, period, currency }) => ({
        period,
        currency,
        amount: line.amount,
        tracks: line.tracks
          .filter((t) => summaries.has(t.trackId) && linesByKey.has(lineKey(line.runId, t.trackId)))
          .map((t) => {
            const tl = linesByKey.get(lineKey(line.runId, t.trackId))!;
            return {
              track: summaries.get(t.trackId)!,
              amount: t.amount,
              streams: tl.streams,
              trackAmount: tl.amount,
              baseAmount: tl.baseAmount,
              forfeited: tl.forfeited,
              uplift: tl.uplift,
            };
          })
          .sort((a, b) => b.amount - a.amount),
      })) satisfies EarningsPeriod[];
    });

    /** An artist's running balance: earnings in, clawbacks and payouts out. */
    app.get("/me/balance", async (request) => {
      const user = await requireUser(db, request);
      const [rows, myStrikes] = await Promise.all([
        db
          .select({ entry: ledgerEntries, finalizedAt: payoutRuns.finalizedAt })
          .from(ledgerEntries)
          .leftJoin(payoutRuns, eq(payoutRuns.id, ledgerEntries.runId))
          .where(eq(ledgerEntries.userId, user.id))
          .orderBy(desc(ledgerEntries.createdAt)),
        loadStrikes(db, { userId: user.id }),
      ]);
      const entries = rows.map(({ entry: e, finalizedAt }) => ({
        id: e.id,
        type: e.type,
        amount: e.amount,
        note: e.note,
        pending: e.type === "earnings" && !finalizedAt,
        createdAt: e.createdAt.toISOString(),
      }));
      const pending = entries.filter((e) => e.pending).reduce((acc, e) => acc + e.amount, 0);
      const balance = entries.reduce((acc, e) => acc + e.amount, 0);
      return {
        currency: config.currency,
        balance,
        available: balance - pending,
        pending,
        entries,
        strikes: myStrikes.map((s) => s.strike),
        suspended: user.suspendedAt !== null,
      } satisfies Balance;
    });

    /** Public: how the money moved, month by month. */
    app.get("/transparency", async () => {
      const live = await db.select({ aiScore: tracks.aiScore }).from(tracks).where(eq(tracks.status, "live"));
      const catalog: Record<AiLabel, number> = { human: 0, ai_assisted: 0, ai_generated: 0 };
      for (const t of live) catalog[aiLabel(t.aiScore)] += 1;

      return {
        currency: config.currency,
        platformSharePercent: DEFAULT_PAYOUT_CONFIG.platformShareBps / 100,
        minStreamSeconds: DEFAULT_PAYOUT_CONFIG.minStreamMs / 1000,
        catalog,
        runs: await runSummaries(db),
      } satisfies Transparency;
    });
  };
