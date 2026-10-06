import type { PayoutRunSummary } from "@trusic/client";
import { aiLabel, calculatePayouts, DEFAULT_PAYOUT_CONFIG, type AiLabel } from "@trusic/core";
import { and, count, desc, eq, gte, inArray, lt, sum } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  artists,
  payoutListenerStatements,
  payoutPayeeLines,
  payoutRuns,
  payoutTrackLines,
  plays,
  revenueEntries,
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

/**
 * Calculate a month's payouts from plays and revenue, and store the results.
 * Re-running a period replaces its previous results.
 *
 * TODO before real money moves: lock a run once it has been paid out, and
 * snapshot each track's AI score at play time rather than at run time.
 */
export async function runPayouts(db: Db, period: string, currency: string): Promise<PayoutRunSummary> {
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

  const [previous] = await db
    .select({ totals: payoutRuns.totals })
    .from(payoutRuns)
    .where(eq(payoutRuns.period, previousPeriod(period)))
    .limit(1);

  const splitsByTrack = new Map<string, { payeeId: string; shareBps: number }[]>();
  for (const s of splitRows) {
    const list = splitsByTrack.get(s.trackId) ?? [];
    list.push({ payeeId: s.userId, shareBps: s.shareBps });
    splitsByTrack.set(s.trackId, list);
  }

  const result = calculatePayouts({
    period,
    config,
    tracks: trackRows.map((t) => ({
      id: t.id,
      aiScore: t.aiScore,
      splits: splitsByTrack.get(t.id) ?? [{ payeeId: t.ownerUserId, shareBps: 10_000 }],
    })),
    listenerRevenue: revenueRows
      .filter((r) => r.userId !== null)
      .map((r) => ({ listenerId: r.userId!, amount: Number(r.amount ?? 0) })),
    unattributedRevenue: Number(revenueRows.find((r) => r.userId === null)?.amount ?? 0),
    carriedIn: previous?.totals.carriedForward ?? 0,
    streams,
  });

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
  });

  const [summary] = await runSummaries(db, period);
  return summary!;
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
    byLabel: byRun.get(r.id) ?? { human: empty(), ai_assisted: empty(), ai_generated: empty() },
    createdAt: r.createdAt.toISOString(),
  }));
}
