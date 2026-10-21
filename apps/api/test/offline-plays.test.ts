import { randomUUID } from "node:crypto";
import type { PlayBatchResult, PlayReport, TrackDetail } from "@trusic/client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { plays, subscriptionPeriods, users } from "../src/db/schema";
import { call, createTestApp, declaration, register, sendFile, wav, type TestApp } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-21T12:00:00Z");
const ago = (ms: number) => new Date(Date.now() - ms);

let t: TestApp;
let band: { token: string; id: string };
let fan: { token: string; id: string };
const track: Record<string, string> = {};

const play = (trackId: string, playedAt: Date, msPlayed = 45_000, id: string = randomUUID()): PlayReport => ({
  id,
  trackId,
  playedAt: playedAt.toISOString(),
  msPlayed,
});
const send = (who: { token: string }, reports: PlayReport[]) =>
  call<PlayBatchResult>(t, "POST", "/api/plays/batch", who.token, { plays: reports });
const rowsFor = (userId: string) => t.database.db.select().from(plays).where(eq(plays.userId, userId));

beforeAll(async () => {
  // Only the clock is faked, so dates are predictable but everything else runs normally.
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  t = await createTestApp();
  band = await register(t, "band@trusic.test");
  fan = await register(t, "fan@trusic.test");
  const artist = (await call<{ id: string }>(t, "POST", "/api/artists", band.token, { name: "The Band" })).body;
  for (const title of ["One", "Two", "Three", "Gone"]) {
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
  await call(t, "DELETE", `/api/tracks/${track.Gone}`, band.token);

  // A subscriber since the summer.
  await t.database.db.update(users).set({ plan: "premium" }).where(eq(users.id, fan.id));
  await t.database.db.insert(subscriptionPeriods).values({ userId: fan.id, startedAt: new Date("2026-07-01") });
});
afterAll(async () => {
  await t?.close();
  vi.useRealTimers();
});

describe("plays from the apps' play queue", () => {
  it("needs a login", async () => {
    expect((await call(t, "POST", "/api/plays/batch", undefined, { plays: [play(track.One!, NOW)] })).status).toBe(401);
  });

  it("counts each play once, however often it's sent", async () => {
    const long = play(track.One!, ago(60 * 60 * 1000));
    const short = play(track.Two!, ago(2 * 60 * 60 * 1000), 10_000);
    const first = await send(fan, [long, short]);
    expect(first.status).toBe(200);
    expect(first.body.results).toEqual([
      { id: long.id, status: "counted" },
      { id: short.id, status: "recorded" },
    ]);
    // The connection dropped before the app heard back, so it sends them again.
    expect((await send(fan, [long, short])).body).toEqual(first.body);
    expect(await rowsFor(fan.id)).toHaveLength(2);

    // The phone reported a listen early (going to the background), then again when it ended.
    expect((await send(fan, [{ ...short, msPlayed: 40_000 }])).body.results).toEqual([
      { id: short.id, status: "counted" },
    ]);
    // A shorter report never shortens it.
    await send(fan, [{ ...short, msPlayed: 5_000 }]);
    const rows = await rowsFor(fan.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.clientPlayId === short.id)?.msPlayed).toBe(40_000);
  });

  it("keeps the longest report when a play is in a batch twice", async () => {
    const p = play(track.Three!, ago(DAY), 20_000);
    const res = await send(fan, [p, { ...p, msPlayed: 50_000 }]);
    expect(res.body.results).toEqual([{ id: p.id, status: "counted" }]);
    const [row] = (await rowsFor(fan.id)).filter((r) => r.clientPlayId === p.id);
    expect(row?.msPlayed).toBe(42_000); // capped at the track's 40 seconds, plus slack
  });

  it("dates a play from a phone with its clock ahead as now, and records the track's score", async () => {
    const p = play(track.One!, new Date(NOW.getTime() + 3 * DAY));
    await send(fan, [p]);
    const [row] = (await rowsFor(fan.id)).filter((r) => r.clientPlayId === p.id);
    expect(row?.playedAt.toISOString()).toBe(NOW.toISOString());
    expect(row?.aiScore).toBe(0);
  });

  it("refuses plays more than 30 days old", async () => {
    const old = play(track.One!, ago(31 * DAY));
    const recent = play(track.One!, ago(29 * DAY));
    const res = await send(fan, [old, recent]);
    expect(res.body.results).toEqual([
      { id: old.id, status: "rejected", reason: "too_old" },
      { id: recent.id, status: "counted" },
    ]);
    expect((await rowsFor(fan.id)).some((r) => r.clientPlayId === old.id)).toBe(false);
  });

  it("refuses plays of tracks that have been taken down", async () => {
    const p = play(track.Gone!, ago(DAY));
    expect((await send(fan, [p])).body.results).toEqual([{ id: p.id, status: "rejected", reason: "unavailable" }]);
  });

  it("only counts plays made while the listener was subscribed", async () => {
    const listener = await register(t, "lapsed@trusic.test");
    const before = play(track.One!, ago(60_000));
    vi.setSystemTime(NOW.getTime() + 60_000);
    await call(t, "POST", "/api/billing/subscribe", listener.token);
    vi.setSystemTime(NOW.getTime() + 10 * 60_000);
    const during = play(track.Two!, new Date());
    vi.setSystemTime(NOW.getTime() + 20 * 60_000);
    await call(t, "POST", "/api/billing/cancel", listener.token);
    vi.setSystemTime(NOW.getTime() + 30 * 60_000);
    const after = play(track.Three!, new Date());

    // Sent after the subscription ended: the play made while subscribed still counts.
    const res = await send(listener, [before, during, after]);
    expect(res.body.results).toEqual([
      { id: before.id, status: "rejected", reason: "not_subscribed" },
      { id: during.id, status: "counted" },
      { id: after.id, status: "rejected", reason: "not_subscribed" },
    ]);
    vi.setSystemTime(NOW);
  });

  it("refuses everything from someone who never subscribed", async () => {
    const visitor = await register(t, "visitor@trusic.test");
    const p = play(track.One!, NOW);
    expect((await send(visitor, [p])).body.results).toEqual([
      { id: p.id, status: "rejected", reason: "not_subscribed" },
    ]);
  });

  it("counts a subscriber with no history (such as a demo account) as subscribed since they joined", async () => {
    const demo = await register(t, "demo@trusic.test");
    const [row] = await t.database.db
      .update(users)
      .set({ plan: "premium" })
      .where(eq(users.id, demo.id))
      .returning({ createdAt: users.createdAt });
    // The database's own clock dated the account, so work from that.
    vi.setSystemTime(row!.createdAt.getTime() + 2 * 60_000);
    const early = play(track.One!, new Date(row!.createdAt.getTime() - 60_000));
    const p = play(track.One!, new Date(row!.createdAt.getTime() + 60_000));
    expect((await send(demo, [early, p])).body.results).toEqual([
      { id: early.id, status: "rejected", reason: "not_subscribed" },
      { id: p.id, status: "counted" },
    ]);
    vi.setSystemTime(NOW);
    const history = await t.database.db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.userId, demo.id));
    expect(history).toHaveLength(1);
  });

  it("checks what it's sent", async () => {
    const bad = await call(t, "POST", "/api/plays/batch", fan.token, {
      plays: [{ id: "not-a-uuid", trackId: track.One, playedAt: "yesterday", msPlayed: -1 }],
    });
    expect(bad.status).toBe(400);
    expect((await call(t, "POST", "/api/plays/batch", fan.token, { plays: [] })).status).toBe(400);
  });
});
