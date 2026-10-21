import { randomUUID } from "node:crypto";
import type { ListenerStatementView, PayoutRunSummary, PlayBatchResult, PlayReport, TrackDetail } from "@trusic/client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { plays, revenueEntries, subscriptionPeriods, users } from "../src/db/schema";
import { computeClawback } from "../src/payout-service";
import { ADMIN_EMAIL, call, createTestApp, declaration, register, sendFile, wav, type TestApp } from "./helpers";

/**
 * Offline plays reach us late. A finalised month never changes: plays for it that
 * arrive afterwards (or between calculating and finalising it) count in the next
 * month calculated, paid from the listener's money for that month.
 */
const NOW = new Date("2026-10-21T12:00:00Z");
const SEPTEMBER = "2026-09";
const OCTOBER = "2026-10";

let t: TestApp;
let admin: { token: string; id: string };
let listener: { token: string; id: string };
const track: Record<string, string> = {};

const play = (trackId: string, playedAt: string, msPlayed = 45_000, id: string = randomUUID()): PlayReport => ({
  id,
  trackId,
  playedAt,
  msPlayed,
});
const send = async (reports: PlayReport[]) => {
  const res = await call<PlayBatchResult>(t, "POST", "/api/plays/batch", listener.token, { plays: reports });
  expect(res.status).toBe(200);
  return res.body.results;
};
const run = (period: string) => call<PayoutRunSummary>(t, "POST", "/api/admin/payouts/run", admin.token, { period });
const statement = async (period: string) =>
  (await call<ListenerStatementView[]>(t, "GET", "/api/me/statements", listener.token)).body.find(
    (s) => s.period === period,
  )!;
const streamsByTitle = (s: ListenerStatementView) =>
  Object.fromEntries(s.allocations.map((a) => [a.track.title, a.streams]));

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  t = await createTestApp();
  admin = await register(t, ADMIN_EMAIL);
  const band = await register(t, "band@trusic.test");
  listener = await register(t, "listener@trusic.test");
  const artist = (await call<{ id: string }>(t, "POST", "/api/artists", band.token, { name: "The Band" })).body;
  for (const title of ["Alpha", "Beta"]) {
    const res = await sendFile(
      t,
      "POST",
      "/api/tracks",
      band.token,
      { artistId: artist.id, title, declaration: JSON.stringify(declaration()) },
      { name: "audio", filename: `${title}.wav`, data: wav({ seconds: 40 }) },
    );
    track[title] = (res.body as TrackDetail).id;
  }
  const { db } = t.database;
  await db.update(users).set({ plan: "premium" }).where(eq(users.id, listener.id));
  await db.insert(subscriptionPeriods).values({ userId: listener.id, startedAt: new Date("2026-08-01") });
  await db.insert(revenueEntries).values([
    { userId: listener.id, period: SEPTEMBER, source: "subscription", amount: 1000 },
    { userId: listener.id, period: OCTOBER, source: "subscription", amount: 1000 },
  ]);
});
afterAll(async () => {
  await t?.close();
  vi.useRealTimers();
});

describe("late plays", () => {
  const short = play("", "2026-09-28T10:00:00Z", 10_000);

  it("leave a calculated month as it was, and count in the next month calculated", async () => {
    await send([play(track.Alpha!, "2026-09-25T10:00:00Z")]);
    const calculated = await run(SEPTEMBER);
    expect(calculated.body.totals.streams).toBe(1);

    // Arrives after September was calculated, but before it was finalised.
    await send([play(track.Beta!, "2026-09-26T10:00:00Z")]);
    // Too short to count yet: the rest of the listen is reported after September is finalised.
    short.trackId = track.Beta!;
    expect(await send([short])).toEqual([{ id: short.id, status: "recorded" }]);

    const final = await call<PayoutRunSummary>(t, "POST", `/api/admin/payouts/${SEPTEMBER}/finalize`, admin.token);
    expect(final.body.totals.streams).toBe(1);

    // Arrive after September was finalised.
    await send([play(track.Beta!, "2026-09-27T10:00:00Z")]);
    expect(await send([{ ...short, msPlayed: 40_000 }])).toEqual([{ id: short.id, status: "counted" }]);
    expect((await run(SEPTEMBER)).status).toBe(409);

    // October's own play, plus September's three late streams.
    await send([play(track.Alpha!, "2026-10-05T10:00:00Z")]);
    const october = await run(OCTOBER);
    expect(october.body.totals.streams).toBe(4);
    expect(october.body.totals.paidToArtists).toBe(800);

    const sept = await statement(SEPTEMBER);
    expect(streamsByTitle(sept)).toEqual({ Alpha: 1 });
    expect(sept.lateStreams).toBeUndefined();
    const oct = await statement(OCTOBER);
    expect(streamsByTitle(oct)).toEqual({ Alpha: 1, Beta: 3 });
    expect(oct.lateStreams).toBe(3);

    const rows = await t.database.db.select().from(plays).where(eq(plays.userId, listener.id));
    expect(rows.map((r) => [r.playedAt.toISOString().slice(0, 10), r.countedInPeriod]).sort()).toEqual([
      ["2026-09-25", SEPTEMBER],
      ["2026-09-26", OCTOBER],
      ["2026-09-27", OCTOBER],
      ["2026-09-28", OCTOBER],
      ["2026-10-05", OCTOBER],
    ]);
  });

  it("join a month that's recalculated before it's finalised", async () => {
    await send([play(track.Alpha!, "2026-10-06T10:00:00Z")]);
    expect((await run(OCTOBER)).body.totals.streams).toBe(5);
  });

  it("never change what a finalised month is recalculated with, so clawbacks stay exact", async () => {
    // Recalculating September with Alpha at AI 50: if Beta's late plays had crept into September,
    // Alpha would have been due less than it was paid, and this would find a clawback.
    const clawback = await computeClawback(t.database.db, track.Alpha!, 50);
    expect(clawback.months).toEqual([]);
    expect(clawback.total).toBe(0);
  });
});
