import type { PayoutRunSummary } from "@trusic/client";
import {
  aiLabel,
  allocate,
  calculatePayouts,
  DEFAULT_PAYOUT_CONFIG,
  type AiLabel,
  type PayoutInput,
} from "@trusic/core";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sum } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  artists,
  ledgerEntries,
  payoutListenerStatements,
  payoutPayeeLines,
  payoutRuns,
  payoutTrackLines,
  plays,
  revenueEntries,
  strikes,
  trackSplits,
  tracks,
} from "./db/schema";
import { HttpError } from "./errors";

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-10" for October 2026, in UTC. */
export function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function previousPeriod(period: string): string {
  const [start] = periodBounds(period);
  return currentPeriod(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)));
}

export function periodBounds(period: string): [Date, Date] {
  const m = PERIOD.exec(period);
  if (!m) throw new HttpError(400, `Period must look like 2026-10, got "${period}".`);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  return [new Date(Date.UTC(year, month, 1)), new Date(Date.UTC(year, month + 1, 1))];
}

const chunk = <T>(items: T[], size = 500): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

interface GatherOptions {
  /** Use these AI scores instead of each track's current one (for recalculating a past month). */
  scores?: Map<string, number>;
  carriedIn?: number;
  clawbacksIn?: number;
}

/** Everything the payout engine needs for one month, read from the database. */
async function gatherPayoutInput(db: Db, period: string, options: GatherOptions = {}): Promise<PayoutInput> {
  const [start, end] = periodBounds(period);
  const config = DEFAULT_PAYOUT_CONFIG;

  const streams = await db
    .select({ listenerId: plays.userId, trackId: plays.trackId, streams: count() })
    .from(plays)
    .where(and(gte(plays.playedAt, start), lt(plays.playedAt, end), gte(plays.msPlayed, config.minStreamMs)))
    .groupBy(plays.userId, plays.trackId);

  const trackIds = [...new Set(streams.map((s) => s.trackId))];
  const trackRows = trackIds.length
    ? await db
        .select({ id: tracks.id, aiScore: tracks.aiScore, ownerUserId: artists.ownerUserId })
        .from(tracks)
        .innerJoin(artists, eq(artists.id, tracks.artistId))
        .where(inArray(tracks.id, trackIds))
    : [];
  const splitRows = trackIds.length
    ? await db.select().from(trackSplits).where(inArray(trackSplits.trackId, trackIds))
    : [];

  const revenueRows = await db
    .select({ userId: revenueEntries.userId, amount: sum(revenueEntries.amount) })
    .from(revenueEntries)
    .where(eq(revenueEntries.period, period))
    .groupBy(revenueEntries.userId);

  let carriedIn = options.carriedIn;
  if (carriedIn === undefined) {
    const [previous] = await db
      .select({ totals: payoutRuns.totals })
      .from(payoutRuns)
      .where(eq(payoutRuns.period, previousPeriod(period)))
      .limit(1);
    carriedIn = previous?.totals.carriedForward ?? 0;
  }

  const splitsByTrack = new Map<string, { payeeId: string; shareBps: number }[]>();
  for (const s of splitRows) {
    const list = splitsByTrack.get(s.trackId) ?? [];
    list.push({ payeeId: s.userId, shareBps: s.shareBps });
    splitsByTrack.set(s.trackId, list);
  }

  return {
    period,
    config,
    tracks: trackRows.map((t) => ({
      id: t.id,
      aiScore: options.scores?.get(t.id) ?? t.aiScore,
      splits: splitsByTrack.get(t.id) ?? [{ payeeId: t.ownerUserId, shareBps: 10_000 }],
    })),
    listenerRevenue: revenueRows
      .filter((r) => r.userId !== null)
      .map((r) => ({ listenerId: r.userId!, amount: Number(r.amount ?? 0) })),
    unattributedRevenue: Number(revenueRows.find((r) => r.userId === null)?.amount ?? 0),
    carriedIn,
    clawbacksIn: options.clawbacksIn ?? 0,
    streams,
  };
}

/**
 * Calculate a month's payouts from plays and revenue, and store the results.
 * Re-running a period replaces its previous results, including its ledger entries,
 * until the month is finalised. Clawbacks not yet paid out to human music are
 * added to this month's human pot.
 */
export async function runPayouts(db: Db, period: string, currency: string): Promise<PayoutRunSummary> {
  periodBounds(period);
  const [existing] = await db
    .select({ finalizedAt: payoutRuns.finalizedAt })
    .from(payoutRuns)
    .where(eq(payoutRuns.period, period))
    .limit(1);
  if (existing?.finalizedAt) {
    throw new HttpError(409, `${period} is finalised and can't be recalculated. Corrections are made with clawbacks.`);
  }
  const pending = await db
    .select({ id: strikes.id, amount: strikes.clawbackTotal })
    .from(strikes)
    .where(or(isNull(strikes.appliedInPeriod), eq(strikes.appliedInPeriod, period)));
  const clawbacksIn = pending.reduce((acc, s) => acc + s.amount, 0);

  const result = calculatePayouts(await gatherPayoutInput(db, period, { clawbacksIn }));

  await db.transaction(async (tx) => {
    await tx.delete(payoutRuns).where(eq(payoutRuns.period, period));
    const [run] = await tx
      .insert(payoutRuns)
      .values({ period, currency, config: result.config, totals: result.totals, humanPot: result.humanPot })
      .returning({ id: payoutRuns.id });
    const runId = run!.id;

    for (const rows of chunk(result.tracks)) {
      await tx.insert(payoutTrackLines).values(rows.map((t) => ({ runId, ...t })));
    }
    for (const rows of chunk(result.payees)) {
      await tx
        .insert(payoutPayeeLines)
        .values(rows.map((p) => ({ runId, userId: p.payeeId, amount: p.amount, tracks: p.tracks })));
      await tx
        .insert(ledgerEntries)
        .values(
          rows.map((p) => ({ userId: p.payeeId, type: "earnings" as const, amount: p.amount, runId, note: period })),
        );
    }
    for (const rows of chunk(result.listeners)) {
      await tx.insert(payoutListenerStatements).values(
        rows.map((l) => ({
          runId,
          userId: l.listenerId,
          revenue: l.revenue,
          platform: l.platform,
          artistShare: l.artistShare,
          allocations: l.allocations,
          toHumanPot: l.toHumanPot,
        })),
      );
    }
    if (pending.length) {
      await tx
        .update(strikes)
        .set({ appliedInPeriod: period })
        .where(
          inArray(
            strikes.id,
            pending.map((s) => s.id),
          ),
        );
    }
  });

  const [summary] = await runSummaries(db, period);
  return summary!;
}

/** Lock a month: its earnings become available to pay out and it can no longer be recalculated. */
export async function finalizeRun(db: Db, period: string): Promise<PayoutRunSummary> {
  const updated = await db
    .update(payoutRuns)
    .set({ finalizedAt: new Date() })
    .where(and(eq(payoutRuns.period, period), isNull(payoutRuns.finalizedAt)))
    .returning({ id: payoutRuns.id });
  if (updated.length === 0) throw new HttpError(404, `There's no unfinalised payout run for ${period}.`);
  const [summary] = await runSummaries(db, period);
  return summary!;
}

/** Months the track was paid in that are still open, oldest first. */
export async function openPeriodsForTrack(db: Db, trackId: string): Promise<string[]> {
  const rows = await db
    .select({ period: payoutRuns.period })
    .from(payoutTrackLines)
    .innerJoin(payoutRuns, eq(payoutRuns.id, payoutTrackLines.runId))
    .where(and(eq(payoutTrackLines.trackId, trackId), isNull(payoutRuns.finalizedAt)))
    .orderBy(payoutRuns.period);
  return rows.map((r) => r.period);
}

export interface Clawback {
  total: number;
  /** What each payee owes back. */
  byPayee: Map<string, number>;
  months: { period: string; paid: number; shouldHaveBeen: number }[];
}

/**
 * How much a track over-earned because its score was too low, in finalised
 * months. (Open months are simply recalculated instead.) Each month is
 * recalculated exactly, with the corrected score and every other track's score
 * as it was that month. The difference is shared between the track's payees in
 * the same proportions they were paid.
 */
export async function computeClawback(db: Db, trackId: string, correctedScore: number): Promise<Clawback> {
  const lines = await db
    .select({ run: payoutRuns, aiScore: payoutTrackLines.aiScore, amount: payoutTrackLines.amount })
    .from(payoutTrackLines)
    .innerJoin(payoutRuns, eq(payoutRuns.id, payoutTrackLines.runId))
    .where(and(eq(payoutTrackLines.trackId, trackId), isNotNull(payoutRuns.finalizedAt)))
    .orderBy(payoutRuns.period);

  const byPayee = new Map<string, number>();
  const months: Clawback["months"] = [];
  for (const line of lines) {
    if (line.aiScore >= correctedScore || line.amount === 0) continue;
    const historic = await db
      .select({ trackId: payoutTrackLines.trackId, aiScore: payoutTrackLines.aiScore })
      .from(payoutTrackLines)
      .where(eq(payoutTrackLines.runId, line.run.id));
    const scores = new Map(historic.map((h) => [h.trackId, h.aiScore]));
    scores.set(trackId, correctedScore);

    const recalculated = calculatePayouts(
      await gatherPayoutInput(db, line.run.period, {
        scores,
        carriedIn: line.run.totals.carriedIn ?? 0,
        clawbacksIn: line.run.totals.clawbacksIn ?? 0,
      }),
    );
    const shouldHaveBeen = recalculated.tracks.find((t) => t.trackId === trackId)?.amount ?? 0;
    const over = line.amount - shouldHaveBeen;
    if (over <= 0) continue;
    months.push({ period: line.run.period, paid: line.amount, shouldHaveBeen });

    // Share the clawback between payees as they shared the track's money that month.
    const payees = await db
      .select({ userId: payoutPayeeLines.userId, tracks: payoutPayeeLines.tracks })
      .from(payoutPayeeLines)
      .where(eq(payoutPayeeLines.runId, line.run.id));
    const shares = payees
      .map((p) => ({ userId: p.userId, amount: p.tracks.find((t) => t.trackId === trackId)?.amount ?? 0 }))
      .filter((p) => p.amount > 0);
    if (shares.length === 0) continue;
    allocate(
      over,
      shares.map((p) => p.amount),
    ).forEach((amount, i) => {
      const userId = shares[i]!.userId;
      byPayee.set(userId, (byPayee.get(userId) ?? 0) + amount);
    });
  }

  const total = [...byPayee.values()].reduce((a, b) => a + b, 0);
  return { total, byPayee, months };
}

/** Published results for every run (or one period), newest first. */
export async function runSummaries(db: Db, period?: string): Promise<PayoutRunSummary[]> {
  const runs = await db
    .select()
    .from(payoutRuns)
    .where(period ? eq(payoutRuns.period, period) : undefined)
    .orderBy(desc(payoutRuns.period));
  if (runs.length === 0) return [];

  const lines = await db
    .select({
      runId: payoutTrackLines.runId,
      aiScore: payoutTrackLines.aiScore,
      streams: payoutTrackLines.streams,
      amount: payoutTrackLines.amount,
      forfeited: payoutTrackLines.forfeited,
    })
    .from(payoutTrackLines)
    .where(
      inArray(
        payoutTrackLines.runId,
        runs.map((r) => r.id),
      ),
    );

  const empty = () => ({ tracks: 0, streams: 0, amount: 0, forfeited: 0 });
  const byRun = new Map<string, Record<AiLabel, ReturnType<typeof empty>>>();
  for (const line of lines) {
    const buckets = byRun.get(line.runId) ?? { human: empty(), ai_assisted: empty(), ai_generated: empty() };
    const b = buckets[aiLabel(line.aiScore)];
    b.tracks += 1;
    b.streams += line.streams;
    b.amount += line.amount;
    b.forfeited += line.forfeited;
    byRun.set(line.runId, buckets);
  }

  return runs.map((r) => ({
    id: r.id,
    period: r.period,
    currency: r.currency,
    platformSharePercent: r.config.platformShareBps / 100,
    totals: r.totals,
    humanPot: r.humanPot,
    finalizedAt: r.finalizedAt?.toISOString() ?? null,
    byLabel: byRun.get(r.id) ?? { human: empty(), ai_assisted: empty(), ai_generated: empty() },
    createdAt: r.createdAt.toISOString(),
  }));
}
