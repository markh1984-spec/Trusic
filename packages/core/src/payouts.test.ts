import { describe, expect, it } from "vitest";
import { calculatePayouts, countStreams, PayoutInputError, type PayoutInput, type PayoutResult } from "./payouts";

const solo = (id: string, aiScore: number) => ({
  id,
  aiScore,
  splits: [{ payeeId: `${id}-artist`, shareBps: 10_000 }],
});

function expectBalanced(result: PayoutResult) {
  const { revenue, platform, paidToArtists, carriedIn, clawbacksIn, carriedForward } = result.totals;
  expect(platform + paidToArtists + carriedForward).toBe(revenue + carriedIn + clawbacksIn);
  expect(result.payees.reduce((a, p) => a + p.amount, 0)).toBe(paidToArtists);
  expect(result.tracks.reduce((a, t) => a + t.amount, 0)).toBe(paidToArtists);
}

const amountFor = (result: PayoutResult, trackId: string) =>
  result.tracks.find((t) => t.trackId === trackId)?.amount ?? 0;

describe("calculatePayouts", () => {
  it("reproduces the worked example: £10,000 from one listener", () => {
    const result = calculatePayouts({
      period: "2026-10",
      tracks: [solo("human-a", 0), solo("hybrid-b", 20), solo("suno-c", 100)],
      listenerRevenue: [{ listenerId: "sam", amount: 1_000_000 }],
      streams: [
        { listenerId: "sam", trackId: "human-a", streams: 5000 },
        { listenerId: "sam", trackId: "hybrid-b", streams: 3000 },
        { listenerId: "sam", trackId: "suno-c", streams: 2000 },
      ],
    });

    expect(result.totals.platform).toBe(200_000);
    expect(result.totals.artistShare).toBe(800_000);
    expect(amountFor(result, "human-a")).toBe(540_541);
    expect(amountFor(result, "hybrid-b")).toBe(259_459);
    expect(amountFor(result, "suno-c")).toBe(0);

    const c = result.tracks.find((t) => t.trackId === "suno-c")!;
    expect(c.baseAmount).toBe(160_000);
    expect(c.forfeited).toBe(160_000);
    expect(result.totals.forfeitedByAi).toBe(160_000);
    expectBalanced(result);
  });

  it("pays a score-s track exactly (100 - s)% of a human track's per-stream rate", () => {
    const result = calculatePayouts({
      period: "p",
      tracks: [solo("human", 0), solo("mastered-by-ai", 0), solo("ai-vocals", 25)],
      listenerRevenue: [{ listenerId: "l", amount: 2_750_00 }],
      streams: [
        { listenerId: "l", trackId: "human", streams: 10 },
        { listenerId: "l", trackId: "mastered-by-ai", streams: 10 },
        { listenerId: "l", trackId: "ai-vocals", streams: 10 },
      ],
    });
    // Weights 1000 : 1000 : 750 over £2,200 of artist share.
    expect(amountFor(result, "human")).toBe(80_000);
    expect(amountFor(result, "mastered-by-ai")).toBe(80_000);
    expect(amountFor(result, "ai-vocals")).toBe(60_000);
  });

  it("is user-centric: a listener's money only reaches tracks they played", () => {
    const result = calculatePayouts({
      period: "p",
      tracks: [solo("indie", 0), solo("megastar", 0)],
      listenerRevenue: [
        { listenerId: "niche-fan", amount: 1000 },
        { listenerId: "heavy-user", amount: 1000 },
      ],
      streams: [
        { listenerId: "niche-fan", trackId: "indie", streams: 3 },
        { listenerId: "heavy-user", trackId: "megastar", streams: 3000 },
      ],
    });
    // Pro-rata would give the indie artist 0.1% of the pool. User-centric gives them all of their fan's money.
    expect(amountFor(result, "indie")).toBe(800);
    expect(amountFor(result, "megastar")).toBe(800);
  });

  it("sends AI forfeits to the human tracks the same listener played", () => {
    const result = calculatePayouts({
      period: "p",
      tracks: [solo("band", 0), solo("prompted", 100), solo("someone-else", 0)],
      listenerRevenue: [
        { listenerId: "a", amount: 1000 },
        { listenerId: "b", amount: 1000 },
      ],
      streams: [
        { listenerId: "a", trackId: "band", streams: 1 },
        { listenerId: "a", trackId: "prompted", streams: 99 },
        { listenerId: "b", trackId: "someone-else", streams: 1 },
      ],
    });
    expect(amountFor(result, "band")).toBe(800);
    expect(amountFor(result, "someone-else")).toBe(800);
    expect(amountFor(result, "prompted")).toBe(0);
    const a = result.listeners.find((l) => l.listenerId === "a")!;
    expect(a.allocations.find((x) => x.trackId === "prompted")).toMatchObject({ baseAmount: 792, amount: 0 });
  });

  it("puts AI-only listening into the platform-wide human pot", () => {
    const result = calculatePayouts({
      period: "p",
      tracks: [solo("prompted", 100), solo("band-1", 0), solo("band-2", 50)],
      listenerRevenue: [
        { listenerId: "ai-fan", amount: 1000 },
        { listenerId: "band-fan", amount: 0 },
      ],
      streams: [
        { listenerId: "ai-fan", trackId: "prompted", streams: 500 },
        { listenerId: "free-listener", trackId: "band-1", streams: 2 },
        { listenerId: "free-listener", trackId: "band-2", streams: 2 },
      ],
    });
    // £8 of human pot, shared 200 : 100 by human-weighted streams.
    expect(result.humanPot).toMatchObject({ amount: 800, fromAiOnlyListening: 800 });
    expect(amountFor(result, "band-1")).toBe(533);
    expect(amountFor(result, "band-2")).toBe(267);
    expect(amountFor(result, "prompted")).toBe(0);
    expect(result.listeners.find((l) => l.listenerId === "ai-fan")!.toHumanPot).toEqual({
      amount: 800,
      reason: "ai_only",
    });
    expectBalanced(result);
  });

  it("puts subscribers who played nothing, and unattributed revenue, into the human pot", () => {
    const result = calculatePayouts({
      period: "p",
      tracks: [solo("band", 0), solo("prompted", 100)],
      listenerRevenue: [{ listenerId: "idle", amount: 1000 }],
      unattributedRevenue: 500,
      streams: [
        { listenerId: "x", trackId: "band", streams: 1 },
        { listenerId: "x", trackId: "prompted", streams: 1 },
      ],
    });
    expect(result.humanPot).toMatchObject({ fromListenersWithNoStreams: 800, fromUnattributed: 400, amount: 1200 });
    expect(amountFor(result, "band")).toBe(1200);
    expect(result.totals.platform).toBe(300);
    // Without AI weighting the AI track would have had half the pot.
    expect(result.tracks.find((t) => t.trackId === "prompted")).toMatchObject({ baseAmount: 600, forfeited: 600 });
    expectBalanced(result);
  });

  it("carries the human pot forward when there is no human music to pay", () => {
    const result = calculatePayouts({
      period: "p",
      tracks: [solo("prompted", 100)],
      listenerRevenue: [{ listenerId: "l", amount: 1000 }],
      streams: [{ listenerId: "l", trackId: "prompted", streams: 10 }],
    });
    expect(result.totals.carriedForward).toBe(800);
    expect(result.totals.paidToArtists).toBe(0);
    expectBalanced(result);
  });

  it("pays last period's carried-forward pot to human music, with no second platform cut", () => {
    const result = calculatePayouts({
      period: "p",
      tracks: [solo("band", 0)],
      listenerRevenue: [],
      carriedIn: 800,
      streams: [{ listenerId: "free", trackId: "band", streams: 1 }],
    });
    expect(result.totals.platform).toBe(0);
    expect(result.humanPot.fromCarriedIn).toBe(800);
    expect(amountFor(result, "band")).toBe(800);
    expectBalanced(result);
  });

  it("pays clawed-back money to human music, with no second platform cut", () => {
    const result = calculatePayouts({
      period: "p",
      tracks: [solo("band", 0), solo("liar", 100)],
      listenerRevenue: [],
      clawbacksIn: 500,
      streams: [
        { listenerId: "l", trackId: "band", streams: 1 },
        { listenerId: "l", trackId: "liar", streams: 5 },
      ],
    });
    expect(result.humanPot.fromClawbacks).toBe(500);
    expect(amountFor(result, "band")).toBe(500);
    expect(amountFor(result, "liar")).toBe(0);
    expectBalanced(result);
  });

  it("splits a band's money between members", () => {
    const result = calculatePayouts({
      period: "p",
      tracks: [
        {
          id: "song",
          aiScore: 0,
          splits: [
            { payeeId: "singer", shareBps: 4000 },
            { payeeId: "guitarist", shareBps: 3000 },
            { payeeId: "drummer", shareBps: 3000 },
          ],
        },
      ],
      listenerRevenue: [{ listenerId: "l", amount: 1001 }],
      streams: [{ listenerId: "l", trackId: "song", streams: 1 }],
    });
    // £10.01 → £2.00 (rounded) to Trusic, £8.01 to the band.
    expect(result.payees.map((p) => [p.payeeId, p.amount])).toEqual([
      ["singer", 321],
      ["drummer", 240],
      ["guitarist", 240],
    ]);
    expectBalanced(result);
  });

  it("combines several revenue lines for one listener", () => {
    const result = calculatePayouts({
      period: "p",
      tracks: [solo("t", 0)],
      listenerRevenue: [
        { listenerId: "l", amount: 999 },
        { listenerId: "l", amount: 1 },
      ],
      streams: [{ listenerId: "l", trackId: "t", streams: 1 }],
    });
    expect(result.listeners).toHaveLength(1);
    expect(result.listeners[0]!.revenue).toBe(1000);
  });

  it("balances to the penny on a large random month", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    const tracks = Array.from({ length: 60 }, (_, i) => ({
      id: `t${i}`,
      aiScore: [0, 0, 0, 6, 25, 55, 85, 100][i % 8]!,
      splits:
        i % 3 === 0
          ? [
              { payeeId: `p${i}`, shareBps: 5000 },
              { payeeId: `p${i + 1}`, shareBps: 5000 },
            ]
          : [{ payeeId: `p${i}`, shareBps: 10_000 }],
    }));
    const input: PayoutInput = {
      period: "p",
      tracks,
      listenerRevenue: Array.from({ length: 300 }, (_, i) => ({ listenerId: `l${i}`, amount: 999 + (i % 4) * 100 })),
      unattributedRevenue: 123_457,
      streams: Array.from({ length: 4000 }, () => ({
        listenerId: `l${Math.floor(rand() * 400)}`,
        trackId: `t${Math.floor(rand() * 60)}`,
        streams: 1 + Math.floor(rand() * 20),
      })),
    };
    const result = calculatePayouts(input);
    expectBalanced(result);
    expect(result.totals.forfeitedByAi).toBeGreaterThan(0);
    for (const t of result.tracks) if (t.aiScore === 100) expect(t.amount).toBe(0);
    for (const t of result.tracks) if (t.aiScore === 0) expect(t.forfeited).toBe(0);
  });

  it("rejects bad input", () => {
    const base: PayoutInput = { period: "p", tracks: [solo("t", 0)], listenerRevenue: [], streams: [] };
    expect(() =>
      calculatePayouts({ ...base, tracks: [{ id: "t", aiScore: 0, splits: [{ payeeId: "x", shareBps: 9000 }] }] }),
    ).toThrow(PayoutInputError);
    expect(() => calculatePayouts({ ...base, streams: [{ listenerId: "l", trackId: "missing", streams: 1 }] })).toThrow(
      PayoutInputError,
    );
    expect(() => calculatePayouts({ ...base, config: { platformShareBps: 12_000 } })).toThrow(PayoutInputError);
    expect(() => calculatePayouts({ ...base, listenerRevenue: [{ listenerId: "l", amount: 1.5 }] })).toThrow(
      RangeError,
    );
  });
});

describe("countStreams", () => {
  it("only counts plays of at least 30 seconds", () => {
    expect(
      countStreams([
        { listenerId: "l", trackId: "t", msPlayed: 29_999 },
        { listenerId: "l", trackId: "t", msPlayed: 30_000 },
        { listenerId: "l", trackId: "t", msPlayed: 200_000 },
        { listenerId: "m", trackId: "t", msPlayed: 45_000 },
      ]),
    ).toEqual([
      { listenerId: "l", trackId: "t", streams: 2 },
      { listenerId: "m", trackId: "t", streams: 1 },
    ]);
  });
});
