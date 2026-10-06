/**
 * The Trusic payout engine.
 *
 * Rules:
 * 1. Every pound of revenue is split: 20% to Trusic, 80% to artists.
 * 2. User-centric: a listener's 80% only goes to tracks *that listener* played.
 * 3. Human-weighted: within a listener's money, each stream is weighted by
 *    (100 - AI score). A score-0 track earns the full rate, a score-20 track
 *    earns 80% of it, a score-100 track earns nothing. Whatever AI tracks
 *    forfeit goes to the human-made tracks the same listener played.
 * 4. If a listener played nothing, or only fully-AI tracks, their 80% goes to
 *    the platform-wide human pot. Revenue that isn't tied to a listener goes
 *    there too. That pot is shared by human-weighted streams across all listeners.
 * 5. Each track's money is divided between its payees by their agreed splits.
 *
 * All amounts are integer minor units, and every penny is accounted for: Trusic's
 * share + artist payouts + carried forward always equals revenue + carried in.
 */
import { clampScore } from "./ai-score";
import { allocate, assertMinor, sum, type Minor } from "./money";

export interface PayoutConfig {
  /** Trusic's share of revenue in basis points. 2000 = 20%. */
  platformShareBps: number;
  /** A play counts as a stream once at least this much of the track has been heard. */
  minStreamMs: number;
}

export const DEFAULT_PAYOUT_CONFIG: PayoutConfig = {
  platformShareBps: 2000,
  minStreamMs: 30_000,
};

export interface PayoutTrack {
  id: string;
  aiScore: number;
  /** Who gets this track's money. Shares are basis points and must total 10000. */
  splits: { payeeId: string; shareBps: number }[];
}

export interface ListenerRevenue {
  listenerId: string;
  amount: Minor;
}

/** Qualified streams (see `countStreams`) of one track by one listener. */
export interface StreamCount {
  listenerId: string;
  trackId: string;
  streams: number;
}

export interface PayoutInput {
  period: string;
  tracks: PayoutTrack[];
  /** Revenue attributable to a listener (subscription fees, their ad impressions...). */
  listenerRevenue: ListenerRevenue[];
  /** Revenue not tied to any listener. It goes straight to the human pot. */
  unattributedRevenue?: Minor;
  /**
   * Last period's `carriedForward`. Trusic's share was already taken, so it
   * goes into the human pot whole.
   */
  carriedIn?: Minor;
  /** Streams from every listener, paying or not. */
  streams: StreamCount[];
  config?: Partial<PayoutConfig>;
}

export interface TrackPayout {
  trackId: string;
  aiScore: number;
  streams: number;
  /** streams × (100 - score) / 100 */
  humanWeightedStreams: number;
  /** What the track would have earned if nobody's AI score counted. */
  baseAmount: Minor;
  amount: Minor;
  /** Money this track gave up because of its AI score. */
  forfeited: Minor;
  /** Extra money this track received from AI forfeits. */
  uplift: Minor;
}

export interface PayeePayout {
  payeeId: string;
  amount: Minor;
  tracks: { trackId: string; amount: Minor }[];
}

export interface ListenerAllocation {
  trackId: string;
  aiScore: number;
  streams: number;
  /** What this track would have got from the listener with no AI weighting. */
  baseAmount: Minor;
  amount: Minor;
}

export type HumanPotReason = "no_streams" | "ai_only";

export interface ListenerStatement {
  listenerId: string;
  revenue: Minor;
  platform: Minor;
  artistShare: Minor;
  allocations: ListenerAllocation[];
  /** Set when this listener's artist share went to the platform-wide human pot. */
  toHumanPot: { amount: Minor; reason: HumanPotReason } | null;
}

export interface PayoutResult {
  period: string;
  config: PayoutConfig;
  totals: {
    revenue: Minor;
    platform: Minor;
    artistShare: Minor;
    paidToArtists: Minor;
    /** Brought in from last period's human pot. */
    carriedIn: Minor;
    /** Human-pot money with no human streams to go to. Pass it as next period's `carriedIn`. */
    carriedForward: Minor;
    /** Money AI tracks gave up, redistributed to human-made music. */
    forfeitedByAi: Minor;
    streams: number;
    humanWeightedStreams: number;
  };
  humanPot: {
    amount: Minor;
    fromCarriedIn: Minor;
    fromUnattributed: Minor;
    fromListenersWithNoStreams: Minor;
    fromAiOnlyListening: Minor;
  };
  tracks: TrackPayout[];
  payees: PayeePayout[];
  listeners: ListenerStatement[];
}

export class PayoutInputError extends Error {
  override name = "PayoutInputError";
}

/** Turn raw plays into qualified stream counts per listener and track. */
export function countStreams(
  plays: readonly { listenerId: string; trackId: string; msPlayed: number }[],
  minStreamMs: number = DEFAULT_PAYOUT_CONFIG.minStreamMs,
): StreamCount[] {
  const counts = new Map<string, StreamCount>();
  for (const p of plays) {
    if (p.msPlayed < minStreamMs) continue;
    const key = `${p.listenerId}\u0000${p.trackId}`;
    const existing = counts.get(key);
    if (existing) existing.streams += 1;
    else counts.set(key, { listenerId: p.listenerId, trackId: p.trackId, streams: 1 });
  }
  return [...counts.values()];
}

const humanUnits = (streams: number, score: number) => streams * (100 - score);

export function calculatePayouts(input: PayoutInput): PayoutResult {
  const config: PayoutConfig = { ...DEFAULT_PAYOUT_CONFIG, ...input.config };
  validateConfig(config);

  const tracks = new Map<string, PayoutTrack & { aiScore: number }>();
  for (const t of input.tracks) {
    if (tracks.has(t.id)) throw new PayoutInputError(`duplicate track ${t.id}`);
    validateSplits(t);
    tracks.set(t.id, { ...t, aiScore: clampScore(t.aiScore) });
  }
  const scoreOf = (trackId: string) => tracks.get(trackId)!.aiScore;

  // Streams grouped by listener, plus platform-wide totals per track.
  const streamsByListener = new Map<string, Map<string, number>>();
  const totalStreams = new Map<string, number>();
  for (const s of input.streams) {
    if (!tracks.has(s.trackId)) throw new PayoutInputError(`streams reference unknown track ${s.trackId}`);
    if (!Number.isSafeInteger(s.streams) || s.streams < 0) {
      throw new PayoutInputError(`stream count must be a non-negative integer, got ${s.streams}`);
    }
    if (s.streams === 0) continue;
    const mine = streamsByListener.get(s.listenerId) ?? new Map<string, number>();
    mine.set(s.trackId, (mine.get(s.trackId) ?? 0) + s.streams);
    streamsByListener.set(s.listenerId, mine);
    totalStreams.set(s.trackId, (totalStreams.get(s.trackId) ?? 0) + s.streams);
  }

  // A listener can have several revenue lines (subscription + ads...). Combine them.
  const revenueByListener = new Map<string, Minor>();
  for (const r of input.listenerRevenue) {
    assertMinor(r.amount, `revenue for ${r.listenerId}`);
    revenueByListener.set(r.listenerId, (revenueByListener.get(r.listenerId) ?? 0) + r.amount);
  }
  const unattributed = input.unattributedRevenue ?? 0;
  assertMinor(unattributed, "unattributedRevenue");
  const carriedIn = input.carriedIn ?? 0;
  assertMinor(carriedIn, "carriedIn");

  const splitPlatform = (amount: Minor): [Minor, Minor] => {
    if (amount === 0) return [0, 0];
    const [platform, artists] = allocate(amount, [config.platformShareBps, 10_000 - config.platformShareBps]);
    return [platform!, artists!];
  };

  const finalByTrack = new Map<string, Minor>();
  const baseByTrack = new Map<string, Minor>();
  const add = (m: Map<string, Minor>, k: string, v: Minor) => m.set(k, (m.get(k) ?? 0) + v);

  let platformTotal = 0;
  const humanPot = { fromCarriedIn: carriedIn, fromUnattributed: 0, fromListenersWithNoStreams: 0, fromAiOnlyListening: 0 };

  // 1. Each listener's money goes to what they played.
  const listeners: ListenerStatement[] = [];
  for (const listenerId of [...revenueByListener.keys()].sort()) {
    const revenue = revenueByListener.get(listenerId)!;
    const [platform, artistShare] = splitPlatform(revenue);
    platformTotal += platform;

    const played = [...(streamsByListener.get(listenerId) ?? new Map<string, number>())].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const statement: ListenerStatement = {
      listenerId,
      revenue,
      platform,
      artistShare,
      allocations: [],
      toHumanPot: null,
    };

    if (played.length === 0) {
      humanPot.fromListenersWithNoStreams += artistShare;
      if (artistShare > 0) statement.toHumanPot = { amount: artistShare, reason: "no_streams" };
    } else {
      const base = artistShare > 0 ? allocate(artistShare, played.map(([, n]) => n)) : played.map(() => 0);
      const weights = played.map(([trackId, n]) => humanUnits(n, scoreOf(trackId)));
      const hasHuman = weights.some((w) => w > 0);
      const final = hasHuman && artistShare > 0 ? allocate(artistShare, weights) : played.map(() => 0);
      if (!hasHuman) {
        humanPot.fromAiOnlyListening += artistShare;
        if (artistShare > 0) statement.toHumanPot = { amount: artistShare, reason: "ai_only" };
      }

      played.forEach(([trackId, n], i) => {
        add(baseByTrack, trackId, base[i]!);
        add(finalByTrack, trackId, final[i]!);
        statement.allocations.push({
          trackId,
          aiScore: scoreOf(trackId),
          streams: n,
          baseAmount: base[i]!,
          amount: final[i]!,
        });
      });
    }
    listeners.push(statement);
  }

  // 2. Revenue not tied to a listener.
  const [unattributedPlatform, unattributedArtists] = splitPlatform(unattributed);
  platformTotal += unattributedPlatform;
  humanPot.fromUnattributed = unattributedArtists;

  // 3. The human pot is shared by human-weighted streams across the whole platform.
  //    In the "no AI weighting" baseline, AI-only listeners would have paid their
  //    own tracks directly, so only the other two sources go through the pot.
  const potTracks = [...totalStreams.keys()].sort();
  const basePotAmount = humanPot.fromCarriedIn + humanPot.fromUnattributed + humanPot.fromListenersWithNoStreams;
  const humanPotAmount = basePotAmount + humanPot.fromAiOnlyListening;

  let carriedForward = 0;
  const potWeights = potTracks.map((id) => humanUnits(totalStreams.get(id)!, scoreOf(id)));
  if (humanPotAmount > 0) {
    if (potWeights.some((w) => w > 0)) {
      allocate(humanPotAmount, potWeights).forEach((amt, i) => add(finalByTrack, potTracks[i]!, amt));
    } else {
      carriedForward = humanPotAmount;
    }
  }
  if (basePotAmount > 0 && potTracks.length > 0) {
    allocate(basePotAmount, potTracks.map((id) => totalStreams.get(id)!)).forEach((amt, i) =>
      add(baseByTrack, potTracks[i]!, amt),
    );
  }

  // 4. Per-track results.
  const trackPayouts: TrackPayout[] = [];
  for (const t of tracks.values()) {
    const streams = totalStreams.get(t.id) ?? 0;
    const amount = finalByTrack.get(t.id) ?? 0;
    const baseAmount = baseByTrack.get(t.id) ?? 0;
    if (streams === 0 && amount === 0) continue;
    trackPayouts.push({
      trackId: t.id,
      aiScore: t.aiScore,
      streams,
      humanWeightedStreams: humanUnits(streams, t.aiScore) / 100,
      baseAmount,
      amount,
      // Only AI use counts as a forfeit; a penny of rounding on a human track does not.
      forfeited: t.aiScore > 0 ? Math.max(0, baseAmount - amount) : 0,
      uplift: Math.max(0, amount - baseAmount),
    });
  }
  trackPayouts.sort((a, b) => b.amount - a.amount || (a.trackId < b.trackId ? -1 : 1));

  // 5. Split each track's money between its payees.
  const payeeMap = new Map<string, PayeePayout>();
  for (const tp of trackPayouts) {
    if (tp.amount === 0) continue;
    const { splits } = tracks.get(tp.trackId)!;
    const shares = allocate(tp.amount, splits.map((s) => s.shareBps));
    splits.forEach((s, i) => {
      if (shares[i] === 0) return;
      const payee = payeeMap.get(s.payeeId) ?? { payeeId: s.payeeId, amount: 0, tracks: [] };
      payee.amount += shares[i]!;
      payee.tracks.push({ trackId: tp.trackId, amount: shares[i]! });
      payeeMap.set(s.payeeId, payee);
    });
  }
  const payees = [...payeeMap.values()].sort((a, b) => b.amount - a.amount || (a.payeeId < b.payeeId ? -1 : 1));

  const revenue = sum([...revenueByListener.values()]) + unattributed;
  const paidToArtists = sum(payees.map((p) => p.amount));
  if (platformTotal + paidToArtists + carriedForward !== revenue + carriedIn) {
    throw new Error(
      `payout books do not balance: ${platformTotal} + ${paidToArtists} + ${carriedForward} != ${revenue} + ${carriedIn}`,
    );
  }

  const streamTotal = sum([...totalStreams.values()]);
  return {
    period: input.period,
    config,
    totals: {
      revenue,
      platform: platformTotal,
      artistShare: revenue - platformTotal,
      paidToArtists,
      carriedIn,
      carriedForward,
      forfeitedByAi: sum(trackPayouts.map((t) => t.forfeited)),
      streams: streamTotal,
      humanWeightedStreams: sum(trackPayouts.map((t) => humanUnits(t.streams, t.aiScore))) / 100,
    },
    humanPot: { amount: humanPotAmount, ...humanPot },
    tracks: trackPayouts,
    payees,
    listeners,
  };
}

function validateConfig(config: PayoutConfig): void {
  if (!Number.isInteger(config.platformShareBps) || config.platformShareBps < 0 || config.platformShareBps > 10_000) {
    throw new PayoutInputError("platformShareBps must be an integer between 0 and 10000");
  }
  if (!Number.isFinite(config.minStreamMs) || config.minStreamMs < 0) {
    throw new PayoutInputError("minStreamMs must be a non-negative number");
  }
}

function validateSplits(track: PayoutTrack): void {
  if (track.splits.length === 0) throw new PayoutInputError(`track ${track.id} has no payees`);
  let total = 0;
  for (const s of track.splits) {
    if (!Number.isInteger(s.shareBps) || s.shareBps < 0) {
      throw new PayoutInputError(`track ${track.id} has an invalid split for ${s.payeeId}`);
    }
    total += s.shareBps;
  }
  if (total !== 10_000) {
    throw new PayoutInputError(`track ${track.id} splits total ${total} basis points, expected 10000`);
  }
}
