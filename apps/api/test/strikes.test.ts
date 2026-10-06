import type {
  Balance,
  Me,
  PayoutRunSummary,
  StrikeResult,
  SuspendedAccount,
  TrackDetail,
  TrackList,
} from "@trusic/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { plays, revenueEntries } from "../src/db/schema";
import { currentPeriod, previousPeriod } from "../src/payout-service";
import { ADMIN_EMAIL, call, createTestApp, declaration, register, sendFile, wav, type TestApp } from "./helpers";

let t: TestApp;
let admin: { token: string; id: string };
let liar: { token: string; id: string };
let honest: { token: string; id: string };
let fan: { token: string; id: string };
const period = currentPeriod();
const nextPeriod = (() => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 7);
})();
const tracks: Record<string, string> = {};

async function upload(owner: { token: string }, artistId: string, title: string) {
  const res = await sendFile(
    t,
    "POST",
    "/api/tracks",
    owner.token,
    { artistId, title, declaration: JSON.stringify(declaration()) },
    { name: "audio", filename: `${title}.wav`, data: wav({ seconds: 40 }) },
  );
  return res as { status: number; body: TrackDetail };
}

async function listen(trackId: string, times: number) {
  for (let i = 0; i < times; i++) await call(t, "POST", "/api/plays", fan.token, { trackId, msPlayed: 35_000 });
}

const balance = async (who: { token: string }) => (await call<Balance>(t, "GET", "/api/me/balance", who.token)).body;

beforeAll(async () => {
  t = await createTestApp();
  admin = await register(t, ADMIN_EMAIL);
  liar = await register(t, "liar@trusic.test");
  honest = await register(t, "honest@trusic.test");
  fan = await register(t, "fan@trusic.test");
  await call(t, "POST", "/api/billing/subscribe", fan.token);

  const liarArtist = (await call<{ id: string }>(t, "POST", "/api/artists", liar.token, { name: "Totally Real Band" }))
    .body;
  const honestArtist = (await call<{ id: string }>(t, "POST", "/api/artists", honest.token, { name: "Real Band" }))
    .body;
  for (const title of ["Fake One", "Fake Two", "Fake Three"])
    tracks[title] = (await upload(liar, liarArtist.id, title)).body.id;
  tracks.real = (await upload(honest, honestArtist.id, "Real Song")).body.id;

  // The fan's money is split between a "human" track that's really AI, and a real one.
  await listen(tracks["Fake One"]!, 3);
  await listen(tracks.real!, 1);
});
afterAll(async () => {
  await t?.close();
});

describe("strikes and clawbacks", () => {
  let paidToLiar = 0;

  it("finalises a month so it can't be recalculated", async () => {
    const run = await call<PayoutRunSummary>(t, "POST", "/api/admin/payouts/run", admin.token, { period });
    expect(run.body.finalizedAt).toBeNull();
    paidToLiar = (await balance(liar)).balance;
    expect(paidToLiar).toBeGreaterThan(0);
    expect((await balance(liar)).pending).toBe(paidToLiar);

    expect((await call(t, "POST", `/api/admin/payouts/${period}/finalize`, liar.token)).status).toBe(403);
    const final = await call<PayoutRunSummary>(t, "POST", `/api/admin/payouts/${period}/finalize`, admin.token);
    expect(final.body.finalizedAt).not.toBeNull();
    expect((await balance(liar)).available).toBe(paidToLiar);
    expect((await call(t, "POST", "/api/admin/payouts/run", admin.token, { period })).status).toBe(409);
  });

  it("claws back exactly what a falsely declared track over-earned in finalised months", async () => {
    expect(
      (await call(t, "POST", `/api/admin/tracks/${tracks["Fake One"]}/strike`, admin.token, { score: 0, reason: "x" }))
        .status,
    ).toBe(400);
    const res = await call<StrikeResult>(t, "POST", `/api/admin/tracks/${tracks["Fake One"]}/strike`, admin.token, {
      score: 100,
      reason: "Audit found the track was generated with Suno.",
    });
    expect(res.status).toBe(200);
    // At AI 100 the track earns nothing, so every penny it was paid comes back.
    expect(res.body.strike).toMatchObject({ declaredScore: 0, correctedScore: 100, clawbackTotal: paidToLiar });
    expect(res.body).toMatchObject({ strikeCount: 1, suspended: false });

    const after = await balance(liar);
    expect(after.balance).toBe(0);
    expect(after.entries.map((e) => e.type).sort()).toEqual(["clawback", "earnings"]);
    expect(after.strikes).toHaveLength(1);

    const track = await call<TrackDetail>(t, "GET", `/api/tracks/${tracks["Fake One"]}`);
    expect(track.body).toMatchObject({ aiScore: 100, scoreSource: "review" });
  });

  it("pays the clawed-back money to human music in the next run", async () => {
    const next = await call<PayoutRunSummary>(t, "POST", "/api/admin/payouts/run", admin.token, { period: nextPeriod });
    expect(next.body.totals.clawbacksIn).toBe(paidToLiar);
    // Nobody listened next month, so the human pot carries forward rather than vanishing.
    expect(next.body.totals.carriedForward).toBe(paidToLiar);
    expect(previousPeriod(nextPeriod)).toBe(period);
  });

  it("recalculates open months instead of clawing back", async () => {
    // Next month (still open): the fan pays again and plays "Fake Two" and the real song.
    const [y, m] = nextPeriod.split("-").map(Number);
    const midMonth = new Date(Date.UTC(y!, m! - 1, 15));
    await t.database.db
      .insert(revenueEntries)
      .values({ userId: fan.id, period: nextPeriod, source: "subscription", amount: 1000 });
    await t.database.db.insert(plays).values([
      { userId: fan.id, trackId: tracks["Fake Two"]!, msPlayed: 35_000, playedAt: midMonth },
      { userId: fan.id, trackId: tracks.real!, msPlayed: 35_000, playedAt: midMonth },
    ]);
    await call(t, "POST", "/api/admin/payouts/run", admin.token, { period: nextPeriod });
    const before = await balance(liar);
    expect(before.pending).toBeGreaterThan(0);

    const strike = await call<StrikeResult>(t, "POST", `/api/admin/tracks/${tracks["Fake Two"]}/strike`, admin.token, {
      score: 85,
      reason: "Second false declaration.",
    });
    expect(strike.body.strike.clawbackTotal).toBe(0);
    expect(strike.body).toMatchObject({ strikeCount: 2, suspended: false });
    // The open month was recalculated at AI 85: the track now earns 15% of the human rate.
    const after = await balance(liar);
    expect(after.pending).toBeGreaterThan(0);
    expect(after.pending).toBeLessThan(before.pending);
  });

  it("suspends the account at the third strike, hides its tracks and blocks uploads, until reinstated", async () => {
    const third = await call<StrikeResult>(t, "POST", `/api/admin/tracks/${tracks["Fake Three"]}/strike`, admin.token, {
      score: 100,
      reason: "Third false declaration.",
    });
    expect(third.body).toMatchObject({ strikeCount: 3, suspended: true });

    const me = await call<Me>(t, "GET", "/api/me", liar.token);
    expect(me.body.user.suspended).toBe(true);
    const listed = await call<TrackList>(t, "GET", "/api/tracks");
    expect(listed.body.tracks.map((x) => x.title)).toEqual(["Real Song"]);
    const artistId = me.body.artists[0]!.id;
    expect((await upload(liar, artistId, "Sneaky")).status).toBe(403);

    const suspended = await call<SuspendedAccount[]>(t, "GET", "/api/admin/suspended", admin.token);
    expect(suspended.body).toMatchObject([{ id: liar.id, strikes: 3 }]);

    expect((await call(t, "POST", `/api/admin/users/${liar.id}/reinstate`, admin.token)).status).toBe(204);
    expect((await call<Me>(t, "GET", "/api/me", liar.token)).body.user.suspended).toBe(false);
    expect((await call<TrackList>(t, "GET", "/api/tracks")).body.total).toBe(4);
  });

  it("can strike from an appeal rejection", async () => {
    const appeal = await call<{ id: string }>(t, "POST", `/api/tracks/${tracks.real}/appeals`, honest.token, {
      message: "Please double-check my score, thanks very much.",
    });
    // Rejecting with a strike needs a higher score than declared.
    const res = await call(t, "POST", `/api/admin/appeals/${appeal.body.id}/resolve`, admin.token, {
      decision: "rejected",
      score: 40,
      strike: true,
      note: "The vocals are a voice clone.",
    });
    expect(res.status).toBe(200);
    expect((await balance(honest)).strikes.map((s) => [s.correctedScore, s.reason])).toEqual([
      [40, "The vocals are a voice clone."],
    ]);
  });
});
