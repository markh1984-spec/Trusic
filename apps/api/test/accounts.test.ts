import type {
  AuthResponse,
  Balance,
  EarningsPeriod,
  ListenerStatementView,
  Me,
  PayoutRunSummary,
  SettingsResult,
  Split,
  TrackDetail,
  TrackList,
} from "@trusic/client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailTokens, plays, users } from "../src/db/schema";
import { hashToken } from "../src/email-tokens";
import { currentPeriod } from "../src/payout-service";
import {
  ADMIN_EMAIL,
  call,
  createTestApp,
  declaration,
  lastEmail,
  linkIn,
  png,
  register,
  sendFile,
  wav,
  type TestApp,
} from "./helpers";

let t: TestApp;
beforeAll(async () => {
  // A low payout minimum, so a test can show a deleted account's balance is held rather than paid.
  t = await createTestApp({ env: { PAYOUT_MINIMUM_MINOR: "100" } });
});
afterAll(async () => {
  await t?.close();
});

const PASSWORD = "correct horse battery";
const tokenFrom = (url: string) => new URL(url).searchParams.get("token")!;
const login = (email: string, password = PASSWORD) =>
  call<AuthResponse>(t, "POST", "/api/auth/login", undefined, { email, password });
const me = (token: string) => call<Me>(t, "GET", "/api/me", token);

async function upload(token: string, artistId: string, title: string) {
  return sendFile(
    t,
    "POST",
    "/api/tracks",
    token,
    { artistId, title, declaration: JSON.stringify(declaration()) },
    { name: "audio", filename: `${title}.wav`, data: wav() },
  ) as Promise<{ status: number; body: TrackDetail & { error?: string } }>;
}

describe("email confirmation", () => {
  let newbie: { token: string; id: string };

  it("emails a link at sign-up, and uploads wait for it but listening doesn't", async () => {
    newbie = await register(t, "newbie@trusic.test", { verified: false });
    const mail = await lastEmail(t, "newbie@trusic.test", /Confirm your email/);
    expect(mail.text).toContain("https://trusic.test/verify-email?token=");
    expect(mail.html).toContain("Confirm my email");
    expect((await me(newbie.token)).body.user.emailVerified).toBe(false);

    const artist = (await call<{ id: string }>(t, "POST", "/api/artists", newbie.token, { name: "Newbie" })).body;
    const refused = await upload(newbie.token, artist.id, "Too Soon");
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/confirm your email address/);
    const photo = await sendFile(
      t,
      "PUT",
      `/api/artists/${artist.id}/image`,
      newbie.token,
      {},
      {
        name: "image",
        filename: "me.png",
        data: png(),
        contentType: "image/png",
      },
    );
    expect(photo.status).toBe(403);

    // Browsing and previews don't need it.
    expect((await call(t, "GET", "/api/tracks", newbie.token)).status).toBe(200);
  });

  it("confirms the address once, and the link can't be used again", async () => {
    const url = linkIn(
      await lastEmail(t, "newbie@trusic.test", /Confirm your email/),
      "https://trusic.test/verify-email",
    );
    const token = tokenFrom(url);
    // Only a hash of the token is stored.
    const [stored] = await t.database.db.select().from(emailTokens).where(eq(emailTokens.userId, newbie.id));
    expect(stored!.tokenHash).toBe(hashToken(token));
    expect(stored!.tokenHash).not.toContain(token);

    const ok = await call<{ email: string }>(t, "POST", "/api/auth/verify-email", undefined, { token });
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe("newbie@trusic.test");
    expect((await me(newbie.token)).body.user.emailVerified).toBe(true);
    expect((await call(t, "POST", "/api/auth/verify-email", undefined, { token })).status).toBe(400);

    const artist = (await me(newbie.token)).body.artists[0]!;
    expect((await upload(newbie.token, artist.id, "Now Allowed")).status).toBe(201);
  });

  it("sends the link again, a few times an hour at most", async () => {
    const other = await register(t, "resend@trusic.test", { verified: false });
    expect((await call(t, "POST", "/api/me/verify-email/resend", other.token)).status).toBe(200);
    expect((await call(t, "POST", "/api/me/verify-email/resend", other.token)).status).toBe(200);
    // Sign-up sent one, so that's three this hour.
    const limited = await call<{ error: string }>(t, "POST", "/api/me/verify-email/resend", other.token);
    expect(limited.status).toBe(429);
    expect(t.mailer.sent.filter((m) => m.to === "resend@trusic.test")).toHaveLength(3);
  });
});

describe("forgotten passwords", () => {
  let person: { token: string; id: string };
  const forgot = (email: string, ip = "10.0.0.1") =>
    t.app.inject({
      method: "POST",
      url: "/api/auth/forgot-password",
      headers: { "x-forwarded-for": ip },
      payload: { email },
    });

  beforeAll(async () => {
    person = await register(t, "forgetful@trusic.test", { verified: false });
  });

  it("answers the same whether or not the email has an account", async () => {
    const sentBefore = t.mailer.sent.length;
    const unknown = await forgot("nobody@trusic.test");
    const known = await forgot("Forgetful@trusic.test");
    expect(unknown.statusCode).toBe(200);
    expect(known.statusCode).toBe(200);
    expect(unknown.body).toBe(known.body);

    const mail = await lastEmail(t, "forgetful@trusic.test", /Reset your Trusic password/);
    expect(mail.text).toContain("1 hour");
    await new Promise((r) => setTimeout(r, 100));
    expect(t.mailer.sent.slice(sentBefore).some((m) => m.to === "nobody@trusic.test")).toBe(false);
  });

  it("sets a new password, signs out other sessions and works only once", async () => {
    const other = await login("forgetful@trusic.test");
    const url = linkIn(await lastEmail(t, "forgetful@trusic.test", /Reset/), "https://trusic.test/reset-password");
    const token = tokenFrom(url);

    const short = await call(t, "POST", "/api/auth/reset-password", undefined, { token, password: "short" });
    expect(short.status).toBe(400);
    const reset = await call<AuthResponse>(t, "POST", "/api/auth/reset-password", undefined, {
      token,
      password: "a brand new password",
    });
    expect(reset.status).toBe(200);
    // The link reached their inbox, which also confirms the address.
    expect(reset.body.user.emailVerified).toBe(true);

    expect((await me(person.token)).status).toBe(401);
    expect((await me(other.body.token)).status).toBe(401);
    expect((await me(reset.body.token)).status).toBe(200);
    expect((await login("forgetful@trusic.test")).status).toBe(401);
    expect((await login("forgetful@trusic.test", "a brand new password")).status).toBe(200);
    expect(
      (await call(t, "POST", "/api/auth/reset-password", undefined, { token, password: "another password" })).status,
    ).toBe(400);
    await lastEmail(t, "forgetful@trusic.test", /password was changed/);
  });

  it("refuses links older than an hour", async () => {
    await forgot("forgetful@trusic.test", "10.0.0.2");
    const token = tokenFrom(
      linkIn(await lastEmail(t, "forgetful@trusic.test", /Reset/), "https://trusic.test/reset-password"),
    );
    await t.database.db
      .update(emailTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailTokens.tokenHash, hashToken(token)));
    const res = await call<{ error: string }>(t, "POST", "/api/auth/reset-password", undefined, {
      token,
      password: "yet another password",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/);
  });

  it("limits requests from one place, and links to one account", async () => {
    // Three links an hour per account: this account has had two, so only one more is sent.
    for (const ip of ["10.0.1.1", "10.0.1.2", "10.0.1.3"]) await forgot("forgetful@trusic.test", ip);
    await new Promise((r) => setTimeout(r, 200));
    const resets = t.mailer.sent.filter((m) => m.to === "forgetful@trusic.test" && /Reset/.test(m.subject));
    expect(resets).toHaveLength(3);

    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await forgot(`someone${i}@trusic.test`, "10.9.9.9")).statusCode);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("settings", () => {
  let person: { token: string; id: string };

  beforeAll(async () => {
    person = await register(t, "settings@trusic.test");
  });

  it("changes the display name", async () => {
    const res = await call<SettingsResult>(t, "PATCH", "/api/me", person.token, { displayName: "  New Name " });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe("New Name");
    expect((await call(t, "PATCH", "/api/me", person.token, { displayName: "" })).status).toBe(400);
  });

  it("changes email only once the new address is confirmed", async () => {
    const wrong = await call(t, "POST", "/api/me/email", person.token, { email: "new@trusic.test", password: "nope" });
    expect(wrong.status).toBe(400);
    const taken = await call(t, "POST", "/api/me/email", person.token, {
      email: "newbie@trusic.test",
      password: PASSWORD,
    });
    expect(taken.status).toBe(409);

    const res = await call<SettingsResult>(t, "POST", "/api/me/email", person.token, {
      email: "New@Trusic.test",
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.pendingEmail).toBe("new@trusic.test");
    expect((await me(person.token)).body.pendingEmail).toBe("new@trusic.test");
    // The old address is told, and still works until the new one is confirmed.
    const warning = await lastEmail(t, "settings@trusic.test", /being changed/);
    expect(warning.text).toContain("new@trusic.test");
    expect((await login("settings@trusic.test")).status).toBe(200);

    const url = linkIn(
      await lastEmail(t, "new@trusic.test", /Confirm your new email/),
      "https://trusic.test/verify-email",
    );
    const confirmed = await call<{ email: string }>(t, "POST", "/api/auth/verify-email", undefined, {
      token: tokenFrom(url),
    });
    expect(confirmed.body.email).toBe("new@trusic.test");
    const after = (await me(person.token)).body;
    expect(after.user.email).toBe("new@trusic.test");
    expect(after.user.emailVerified).toBe(true);
    expect(after.pendingEmail).toBeNull();
    expect((await login("settings@trusic.test")).status).toBe(401);
    expect((await login("new@trusic.test")).status).toBe(200);
  });

  it("changes the password with the current one, signing out other sessions", async () => {
    const elsewhere = await login("new@trusic.test");
    const wrong = await call(t, "POST", "/api/me/password", person.token, {
      currentPassword: "wrong one",
      newPassword: "a different password",
    });
    expect(wrong.status).toBe(400);
    const ok = await call(t, "POST", "/api/me/password", person.token, {
      currentPassword: PASSWORD,
      newPassword: "a different password",
    });
    expect(ok.status).toBe(204);
    expect((await me(person.token)).status).toBe(200);
    expect((await me(elsewhere.body.token)).status).toBe(401);
    expect((await login("new@trusic.test", "a different password")).status).toBe(200);
    await lastEmail(t, "new@trusic.test", /password was changed/);
  });

  it("signs out everywhere", async () => {
    const other = await login("new@trusic.test", "a different password");
    expect((await call(t, "POST", "/api/auth/logout-everywhere", person.token)).status).toBe(204);
    expect((await me(person.token)).status).toBe(401);
    expect((await me(other.body.token)).status).toBe(401);
  });
});

describe("your data", () => {
  const period = currentPeriod();
  let admin: { token: string; id: string };
  let band: { token: string; id: string };
  let bassist: { token: string; id: string };
  let fan: { token: string; id: string };
  let otherFan: { token: string; id: string };
  let bandTrack: string;
  let bassistTrack: string;
  let artistSlug: string;

  beforeAll(async () => {
    admin = await register(t, ADMIN_EMAIL);
    band = await register(t, "leaving-band@trusic.test");
    bassist = await register(t, "bassist@trusic.test");
    fan = await register(t, "leaving-fan@trusic.test");
    otherFan = await register(t, "staying-fan@trusic.test");
    for (const f of [fan, otherFan]) await call(t, "POST", "/api/billing/subscribe", f.token);

    const artist = (
      await call<{ id: string; slug: string }>(t, "POST", "/api/artists", band.token, { name: "Leaving Band" })
    ).body;
    artistSlug = artist.slug;
    await sendFile(
      t,
      "PUT",
      `/api/artists/${artist.id}/image`,
      band.token,
      {},
      {
        name: "image",
        filename: "band.png",
        data: png(3),
        contentType: "image/png",
      },
    );
    bandTrack = (await upload(band.token, artist.id, "Last Song")).body.id;
    const bassistArtist = (await call<{ id: string }>(t, "POST", "/api/artists", bassist.token, { name: "Bass Solo" }))
      .body;
    bassistTrack = (await upload(bassist.token, bassistArtist.id, "Low End")).body.id;
    // The leaving band member has a share of the bassist's track.
    await call(t, "PUT", `/api/tracks/${bassistTrack}/splits`, bassist.token, {
      splits: [
        { email: "bassist@trusic.test", shareBps: 7000 },
        { email: "leaving-band@trusic.test", shareBps: 3000 },
      ],
    });

    for (const f of [fan, otherFan]) {
      for (const trackId of [bandTrack, bassistTrack]) {
        await call(t, "POST", "/api/plays", f.token, { trackId, msPlayed: 35_000 });
      }
    }
    await call(t, "PUT", `/api/me/likes/${bassistTrack}`, fan.token);
    await call(t, "PUT", `/api/me/follows/${artist.id}`, fan.token);
    await call(t, "POST", "/api/playlists", fan.token, { name: "Leaving soon" });
    await call(t, "POST", "/api/admin/payouts/run", admin.token, { period });
  });

  it("downloads everything held about the account", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/api/me/export",
      headers: { authorization: `Bearer ${fan.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="trusic-data-\d{4}-\d{2}-\d{2}\.json"/);
    const data = res.json() as Record<string, never[]> & { profile: { email: string } };
    expect(data.profile.email).toBe("leaving-fan@trusic.test");
    expect(data.plays).toHaveLength(2);
    expect(data.likes).toHaveLength(1);
    expect(data.follows).toHaveLength(1);
    expect(data.playlists).toHaveLength(1);
    expect(data.listenerStatements).toHaveLength(1);
    expect(data.subscriptionPayments).toHaveLength(1);
    for (const key of [
      "artists",
      "tracks",
      "ledger",
      "strikes",
      "appeals",
      "reportsYouMade",
      "reportsAboutYourContent",
    ])
      expect(data).toHaveProperty(key);
    expect(res.body).not.toContain("scrypt$");

    const artistData = (
      await t.app.inject({ method: "GET", url: "/api/me/export", headers: { authorization: `Bearer ${band.token}` } })
    ).json() as { tracks: { title: string }[]; artistEarnings: unknown[]; bandSplits: unknown[] };
    expect(artistData.tracks.map((t) => t.title)).toEqual(["Last Song"]);
    expect(artistData.artistEarnings).toHaveLength(1);
    expect(artistData.bandSplits).toHaveLength(2);
  });

  it("needs the password and the word DELETE", async () => {
    expect((await call(t, "POST", "/api/me/delete", band.token, { password: "nope", confirm: "DELETE" })).status).toBe(
      400,
    );
    expect((await call(t, "POST", "/api/me/delete", band.token, { password: PASSWORD, confirm: "yes" })).status).toBe(
      400,
    );
  });

  it("deletes an artist's account without breaking anyone else's money", async () => {
    const statementBefore = (await call<ListenerStatementView[]>(t, "GET", "/api/me/statements", otherFan.token)).body;
    const runBefore = (await call<{ runs: PayoutRunSummary[] }>(t, "GET", "/api/transparency")).body.runs[0]!;
    const bandBalance = (await call<Balance>(t, "GET", "/api/me/balance", band.token)).body.balance;
    expect(bandBalance).toBeGreaterThan(0);

    expect(
      (await call(t, "POST", "/api/me/delete", band.token, { password: PASSWORD, confirm: "DELETE" })).status,
    ).toBe(204);
    await lastEmail(t, "leaving-band@trusic.test", /has been deleted/);

    // Signed out, can't sign in, and the address is free to use again.
    expect((await me(band.token)).status).toBe(401);
    expect((await login("leaving-band@trusic.test")).status).toBe(401);
    const [row] = await t.database.db.select().from(users).where(eq(users.id, band.id));
    expect(row!.email).not.toContain("leaving-band");
    expect(row!.displayName).toBe("Deleted account");
    expect(row!.deletedAt).not.toBeNull();

    // Their music has come down and their profile is gone.
    const list = (await call<TrackList>(t, "GET", "/api/tracks")).body;
    expect(list.tracks.map((t) => t.id)).not.toContain(bandTrack);
    expect((await call(t, "GET", `/api/tracks/${bandTrack}`)).status).toBe(404);
    expect((await call(t, "GET", `/api/artists/${artistSlug}`)).status).toBe(404);
    expect((await call<{ id: string }[]>(t, "GET", "/api/me/follows", fan.token)).body).toHaveLength(0);

    // Their share of the bassist's track went to the bassist.
    const splits = (await call<Split[]>(t, "GET", `/api/tracks/${bassistTrack}/splits`, bassist.token)).body;
    expect(splits).toEqual([expect.objectContaining({ email: "bassist@trusic.test", shareBps: 10_000 })]);

    // Other people's statements and the month's totals are unchanged, and still add up.
    const statementAfter = (await call<ListenerStatementView[]>(t, "GET", "/api/me/statements", otherFan.token)).body;
    expect(statementAfter[0]!.allocations.map((a) => a.amount)).toEqual(
      statementBefore[0]!.allocations.map((a) => a.amount),
    );
    const total = statementAfter[0]!.allocations.reduce((acc, a) => acc + a.amount, 0);
    expect(total).toBe(statementAfter[0]!.artistShare);
    const runAfter = (await call<{ runs: PayoutRunSummary[] }>(t, "GET", "/api/transparency")).body.runs[0]!;
    expect(runAfter.totals).toEqual(runBefore.totals);

    // The month can still be recalculated, and its books still balance.
    const rerun = await call<PayoutRunSummary>(t, "POST", "/api/admin/payouts/run", admin.token, { period });
    expect(rerun.status).toBe(200);
    const totals = rerun.body.totals;
    expect(totals.platform + totals.paidToArtists + totals.carriedForward).toBe(
      totals.revenue + totals.carriedIn + totals.clawbacksIn,
    );
    const bassistEarnings = (await call<EarningsPeriod[]>(t, "GET", "/api/me/earnings", bassist.token)).body;
    expect(bassistEarnings[0]!.tracks[0]!.amount).toBe(bassistEarnings[0]!.tracks[0]!.trackAmount);

    // Signing up again with the same address works, as a brand-new account.
    const again = await register(t, "leaving-band@trusic.test");
    expect(again.id).not.toBe(band.id);
    expect((await me(again.token)).body.artists).toHaveLength(0);
  });

  it("deletes a listener's account, keeping their plays so artists' pay doesn't change", async () => {
    const playsBefore = await t.database.db.select().from(plays).where(eq(plays.userId, fan.id));
    expect((await call(t, "POST", "/api/me/delete", fan.token, { password: PASSWORD, confirm: "DELETE" })).status).toBe(
      204,
    );
    const playsAfter = await t.database.db.select().from(plays).where(eq(plays.userId, fan.id));
    expect(playsAfter).toHaveLength(playsBefore.length);
    expect((await call(t, "GET", "/api/me/playlists", fan.token)).status).toBe(401);
  });

  it("holds money owed to a deleted account instead of paying it", async () => {
    await call(t, "POST", `/api/admin/payouts/${period}/finalize`, admin.token);
    const paid = await call<{ skipped: { userId: string; reason: string }[] }>(
      t,
      "POST",
      "/api/admin/payouts/pay",
      admin.token,
    );
    expect(paid.body.skipped.find((s) => s.userId === band.id)?.reason).toMatch(/Account deleted/);
  });
});
