import type { ArtistMoney, ArtistStats, PayoutRunSummary, StudioArtist, TrackDetail, TrackStats } from "@trusic/client";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { follows, likes, payoutTrackLines, plays } from "../src/db/schema";
import { currentPeriod } from "../src/payout-service";
import { statsWindow } from "../src/stats-service";
import { ADMIN_EMAIL, call, createTestApp, declaration, register, sendFile, wav, type TestApp } from "./helpers";

let t: TestApp;
let admin: { token: string; id: string };
let band: { token: string; id: string };
let bassist: { token: string; id: string };
let stranger: { token: string; id: string };
const fans: { token: string; id: string }[] = [];
let artistId = "";
const ids: Record<string, string> = {};

async function upload(title: string, decl = declaration()) {
  const res = await sendFile(
    t,
    "POST",
    "/api/tracks",
    band.token,
    { artistId, title, genre: "Folk", declaration: JSON.stringify(decl) },
    { name: "audio", filename: `${title}.wav`, data: wav({ seconds: 40, seed: title.length }) },
  );
  expect(res.status).toBe(201);
  return (res.body as TrackDetail).id;
}

/** A few minutes ago, but never before the start of this month, so every play lands in this month's payout run. */
function recently(minutesAgo: number): Date {
  const monthStart = new Date(`${currentPeriod()}-01T00:00:00Z`).getTime();
  return new Date(Math.max(monthStart + 1000, Date.now() - minutesAgo * 60_000));
}

beforeAll(async () => {
  t = await createTestApp();
  admin = await register(t, ADMIN_EMAIL);
  band = await register(t, "band@trusic.test");
  bassist = await register(t, "bassist@trusic.test");
  stranger = await register(t, "stranger@trusic.test");
  for (const n of [1, 2, 3]) {
    const fan = await register(t, `fan${n}@trusic.test`);
    await call(t, "POST", "/api/billing/subscribe", fan.token);
    fans.push(fan);
  }
  artistId = (await call<{ id: string }>(t, "POST", "/api/artists", band.token, { name: "Hollow Pines" })).body.id;
  ids.anthem = await upload("Anthem");
  ids.ballad = await upload("Ballad");
  // Only the anthem is split with the bassist; the ballad is all the band's.
  await call(t, "PUT", `/api/tracks/${ids.anthem}/splits`, band.token, {
    splits: [
      { email: "band@trusic.test", shareBps: 6000 },
      { email: "bassist@trusic.test", shareBps: 4000 },
    ],
  });
});
afterAll(async () => {
  await t?.close();
});

describe("play sources", () => {
  it("records where a play started, accepts plays without one, and never loses a play over an unknown source", async () => {
    const [fan] = fans;
    for (const source of ["playlist", undefined, "car-stereo"]) {
      const res = await call<{ counted: boolean }>(t, "POST", "/api/plays", fan!.token, {
        trackId: ids.ballad,
        msPlayed: 45_000,
        ...(source ? { source } : {}),
      });
      expect(res.status).toBe(201);
      expect(res.body.counted).toBe(true);
    }
    const rows = await t.database.db
      .select({ source: plays.source })
      .from(plays)
      .where(eq(plays.userId, fan!.id))
      .orderBy(plays.playedAt);
    expect(rows.map((r) => r.source).sort()).toEqual(["other", "playlist", null].sort());
    await t.database.db.delete(plays);
  });
});

describe("artist stats", () => {
  beforeAll(async () => {
    const [a, b, c] = fans;
    const db = t.database.db;
    // Fan 1 streams the anthem three times and skips it once; fan 2 streams it once from search;
    // fan 3 streams the ballad from a playlist. A 29.999-second play is not a stream, 30 seconds is.
    await db.insert(plays).values([
      { userId: a!.id, trackId: ids.anthem!, msPlayed: 45_000, source: "release", playedAt: recently(5) },
      { userId: a!.id, trackId: ids.anthem!, msPlayed: 30_000, source: "release", playedAt: recently(4) },
      { userId: a!.id, trackId: ids.anthem!, msPlayed: 45_000, source: "radio", playedAt: recently(3) },
      { userId: a!.id, trackId: ids.anthem!, msPlayed: 29_999, source: "release", playedAt: recently(2) },
      { userId: b!.id, trackId: ids.anthem!, msPlayed: 40_000, source: "search", playedAt: recently(2) },
      { userId: c!.id, trackId: ids.ballad!, msPlayed: 40_000, source: "playlist", playedAt: recently(1) },
      { userId: c!.id, trackId: ids.ballad!, msPlayed: 40_000, source: null, playedAt: recently(1) },
    ]);
    await db.insert(likes).values({ userId: b!.id, trackId: ids.anthem! });
    await db.insert(follows).values([
      { userId: a!.id, artistId },
      { userId: c!.id, artistId },
    ]);
  });

  it("lets the owner, band members in a split and admins see them, and nobody else", async () => {
    const mine = await call<StudioArtist[]>(t, "GET", "/api/studio/artists", bassist.token);
    expect(mine.body.map((a) => [a.artist.name, a.role])).toEqual([["Hollow Pines", "member"]]);
    expect((await call<StudioArtist[]>(t, "GET", "/api/studio/artists", band.token)).body[0]!.role).toBe("owner");

    for (const [who, role] of [
      [band, "owner"],
      [bassist, "member"],
      [admin, "admin"],
    ] as const) {
      const res = await call<ArtistStats>(t, "GET", `/api/studio/artists/${artistId}/stats`, who.token);
      expect(res.status).toBe(200);
      expect(res.body.role).toBe(role);
    }
    expect((await call(t, "GET", `/api/studio/artists/${artistId}/stats`, stranger.token)).status).toBe(403);
    expect((await call(t, "GET", `/api/studio/artists/${artistId}/money`, stranger.token)).status).toBe(403);
    expect((await call(t, "GET", `/api/studio/tracks/${ids.anthem}/stats`, stranger.token)).status).toBe(403);
    expect((await call(t, "GET", `/api/studio/artists/${artistId}/stats`)).status).toBe(401);
  });

  it("counts streams, listeners, short plays, sources, likes and followers", async () => {
    const res = await call<ArtistStats>(t, "GET", `/api/studio/artists/${artistId}/stats?range=7d`, bassist.token);
    const s = res.body;
    expect(s.totals).toEqual({ streams: 6, listeners: 3, shortPlays: 1, likes: 1 });
    expect(s.series).toHaveLength(7);
    expect(s.series.reduce((n, p) => n + p.streams, 0)).toBe(6);
    expect(s.series.at(-1)!.followers).toBe(2);
    expect(s.followers).toBe(2);
    expect(s.sources).toEqual([
      { source: "release", streams: 2 },
      { source: "playlist", streams: 1 },
      { source: "radio", streams: 1 },
      { source: "search", streams: 1 },
      { source: null, streams: 1 },
    ]);
    expect(s.topTracks.map((x) => [x.track.title, x.streams, x.listeners])).toEqual([
      ["Anthem", 4, 2],
      ["Ballad", 2, 1],
    ]);
    expect(s.previous).toEqual({ streams: 0, listeners: 0, shortPlays: 0, likes: 0 });
  });

  it("gives each track the same stats on its own page", async () => {
    const res = await call<TrackStats>(t, "GET", `/api/studio/tracks/${ids.anthem}/stats?range=28d`, band.token);
    expect(res.status).toBe(200);
    expect(res.body.track.title).toBe("Anthem");
    expect(res.body.totals).toEqual({ streams: 4, listeners: 2, shortPlays: 1, likes: 1 });
    expect(res.body.likesTotal).toBe(1);
    expect(res.body.series).toHaveLength(28);
  });

  it("matches the payout engine's streams exactly", async () => {
    const run = await call<PayoutRunSummary>(t, "POST", "/api/admin/payouts/run", admin.token, {
      period: currentPeriod(),
    });
    expect(run.status).toBe(200);
    for (const key of ["anthem", "ballad"]) {
      const [line] = await t.database.db
        .select({ streams: payoutTrackLines.streams })
        .from(payoutTrackLines)
        .where(and(eq(payoutTrackLines.runId, run.body.id), eq(payoutTrackLines.trackId, ids[key]!)));
      // Every play above is in this month, and the 365-day range covers all of this month.
      const stats = await call<TrackStats>(t, "GET", `/api/studio/tracks/${ids[key]}/stats?range=365d`, band.token);
      expect(stats.body.totals.streams).toBe(line!.streams);
    }
  });

  it("shows each person only their own money, by track and month", async () => {
    const owner = (await call<ArtistMoney>(t, "GET", `/api/studio/artists/${artistId}/money`, band.token)).body;
    const member = (await call<ArtistMoney>(t, "GET", `/api/studio/artists/${artistId}/money`, bassist.token)).body;
    const ownerMonth = owner.months.find((m) => m.period === currentPeriod())!;
    const memberMonth = member.months.find((m) => m.period === currentPeriod())!;
    expect(ownerMonth.finalised).toBe(false);
    expect(ownerMonth.tracks.map((x) => x.title).sort()).toEqual(["Anthem", "Ballad"]);
    // The bassist is only in the anthem's split, so the ballad's money isn't theirs to see.
    expect(memberMonth.tracks.map((x) => x.title)).toEqual(["Anthem"]);
    const ownerAnthem = ownerMonth.tracks.find((x) => x.title === "Anthem")!;
    const memberAnthem = memberMonth.tracks[0]!;
    expect(memberAnthem.streams).toBe(4);
    expect(ownerAnthem.amount + memberAnthem.amount).toBeGreaterThan(0);
    expect(Math.abs(ownerAnthem.amount * 4 - memberAnthem.amount * 6)).toBeLessThanOrEqual(6);
    expect(memberMonth.amount).toBe(memberAnthem.amount);

    // An admin who isn't paid for anything sees no money.
    const adminView = (await call<ArtistMoney>(t, "GET", `/api/studio/artists/${artistId}/money`, admin.token)).body;
    expect(adminView.months).toEqual([]);

    // The track page shows the same, for that track only.
    const track = (await call<TrackStats>(t, "GET", `/api/studio/tracks/${ids.anthem}/stats`, bassist.token)).body;
    expect(track.money.months[0]!.tracks).toEqual([memberAnthem]);
  });
});

describe("stats ranges", () => {
  it("covers the last 7, 28 or 365 days including today, in days or weeks starting on Mondays", () => {
    // A Wednesday.
    const now = new Date("2026-10-21T15:00:00Z");
    const week = statsWindow("7d", now);
    expect(week.buckets).toEqual([
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
    ]);
    expect(week.to.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(week.previousFrom.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    const year = statsWindow("365d", now);
    expect(year.bucket).toBe("week");
    expect(year.buckets[0]).toBe("2025-10-22");
    expect(year.buckets[1]).toBe("2025-10-27");
    expect(year.buckets.at(-1)).toBe("2026-10-19");
    expect(year.buckets.slice(1).every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
  });
});
