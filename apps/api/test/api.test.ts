import type {
  AdminAppeal,
  AuthResponse,
  EarningsPeriod,
  ListenerStatementView,
  Me,
  PayoutRunSummary,
  StreamUrl,
  TrackDetail,
  TrackList,
  Transparency,
} from "@trusic/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentPeriod } from "../src/payout-service";
import { ADMIN_EMAIL, createTestApp, declaration, multipart, wav, type TestApp } from "./helpers";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

async function call<T>(method: string, url: string, token?: string, body?: unknown) {
  const res = await t.app.inject({
    method: method as "GET",
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, body: (res.body ? res.json() : null) as T, raw: res };
}

async function register(email: string, displayName = email.split("@")[0]!) {
  const res = await call<AuthResponse>("POST", "/api/auth/register", undefined, {
    email,
    password: "correct horse battery",
    displayName,
  });
  expect(res.status).toBe(201);
  return res.body.token;
}

async function upload(token: string, artistId: string, title: string, decl = declaration(), audio = wav()) {
  const form = multipart(
    { artistId, title, genre: "Indie", declaration: JSON.stringify(decl) },
    { name: "audio", filename: `${title}.wav`, data: audio },
  );
  const res = await t.app.inject({
    method: "POST",
    url: "/api/tracks",
    headers: { ...form.headers, authorization: `Bearer ${token}` },
    payload: form.payload,
  });
  return { status: res.statusCode, body: res.json() as TrackDetail & { error?: string } };
}

async function listen(token: string, trackId: string, times: number, msPlayed = 35_000) {
  for (let i = 0; i < times; i++) {
    const res = await call<{ counted: boolean }>("POST", "/api/plays", token, { trackId, msPlayed });
    expect(res.status).toBe(201);
  }
}

describe("Trusic API", () => {
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  it("registers, logs in and rejects bad credentials", async () => {
    tokens.band = await register("band@trusic.test", "The Real Band");
    tokens.prompter = await register("prompter@trusic.test");
    tokens.fan = await register("fan@trusic.test");
    tokens.drummer = await register("drummer@trusic.test");
    tokens.admin = await register(ADMIN_EMAIL);

    expect(
      (
        await call("POST", "/api/auth/register", undefined, {
          email: "band@trusic.test",
          password: "whatever123",
          displayName: "x",
        })
      ).status,
    ).toBe(409);
    expect(
      (await call("POST", "/api/auth/login", undefined, { email: "band@trusic.test", password: "nope" })).status,
    ).toBe(401);
    const login = await call<AuthResponse>("POST", "/api/auth/login", undefined, {
      email: "BAND@trusic.test",
      password: "correct horse battery",
    });
    expect(login.status).toBe(200);

    const me = await call<Me>("GET", "/api/me", tokens.admin);
    expect(me.body.user.isAdmin).toBe(true);
    expect((await call("GET", "/api/me")).status).toBe(401);
  });

  it("creates artist profiles with unique slugs", async () => {
    const band = await call<{ id: string; slug: string }>("POST", "/api/artists", tokens.band, {
      name: "The Real Band",
    });
    expect(band.status).toBe(201);
    expect(band.body.slug).toBe("the-real-band");
    ids.band = band.body.id;

    const prompter = await call<{ id: string; slug: string }>("POST", "/api/artists", tokens.prompter, {
      name: "The Real Band",
    });
    expect(prompter.body.slug).toBe("the-real-band-2");
    ids.prompter = prompter.body.id;
  });

  it("scores a human-made upload as 0 and ignores AI mastering", async () => {
    const res = await upload(tokens.band!, ids.band!, "Garage Anthem", {
      ...declaration(),
      assistiveTools: ["mastering"],
      toolsUsed: ["LANDR"],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      aiScore: 0,
      aiLabel: "human",
      payoutRatePercent: 100,
      scoreSource: "declared",
      flagged: false,
    });
    expect(res.body.durationMs).toBe(40_000);
    ids.human = res.body.id;
  });

  it("scores a declared fully-AI upload as 100", async () => {
    const all = declaration({
      composition: "generated",
      lyrics: "generated",
      vocals: "generated",
      instrumentation: "generated",
      production: "generated",
    });
    const res = await upload(tokens.prompter!, ids.prompter!, "Prompt Pop", all, wav({ seed: 2 }));
    expect(res.body).toMatchObject({ aiScore: 100, aiLabel: "ai_generated", payoutRatePercent: 0 });
    ids.ai = res.body.id;
  });

  it("flags an upload whose file says it came from Suno, even if declared human", async () => {
    const res = await upload(
      tokens.prompter!,
      ids.prompter!,
      "Totally Human",
      declaration(),
      wav({ seed: 3, comment: "made with suno.com" }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ declaredScore: 0, aiScore: 100, scoreSource: "detected", flagged: true });
    expect(res.body.detection?.evidence[0]).toContain("suno");
    ids.flagged = res.body.id;
  });

  it("rejects bad uploads", async () => {
    expect((await upload(tokens.fan!, ids.band!, "Not mine")).status).toBe(403);
    expect((await upload(tokens.band!, ids.band!, "Junk", declaration(), Buffer.from("not audio at all"))).status).toBe(
      415,
    );
    const badDecl = await upload(tokens.band!, ids.band!, "Bad", { stages: { composition: "lots" } } as never);
    expect(badDecl.status).toBe(400);
  });

  it("lists, searches and filters tracks by AI label", async () => {
    const all = await call<TrackList>("GET", "/api/tracks");
    expect(all.body.total).toBe(3);
    const human = await call<TrackList>("GET", "/api/tracks?label=human");
    expect(human.body.tracks.map((x) => x.title)).toEqual(["Garage Anthem"]);
    const search = await call<TrackList>("GET", "/api/tracks?q=prompt");
    expect(search.body.tracks.map((x) => x.title)).toEqual(["Prompt Pop"]);
  });

  it("streams audio through signed URLs with range support", async () => {
    expect((await call("GET", `/api/tracks/${ids.human}/stream`)).status).toBe(401);
    const signed = await call<StreamUrl>("GET", `/api/tracks/${ids.human}/stream`, tokens.fan);
    expect(signed.status).toBe(200);

    const partial = await t.app.inject({ method: "GET", url: signed.body.url, headers: { range: "bytes=0-99" } });
    expect(partial.statusCode).toBe(206);
    expect(partial.headers["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
    expect(partial.rawPayload.subarray(0, 4).toString()).toBe("RIFF");
    expect(partial.rawPayload.length).toBe(100);

    const full = await t.app.inject({ method: "GET", url: signed.body.url });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("audio/wav");

    const tampered = signed.body.url.replace(ids.human!, ids.ai!);
    expect((await t.app.inject({ method: "GET", url: tampered })).statusCode).toBe(403);
  });

  it("lets an artist appeal a flagged track, and an admin uphold it", async () => {
    expect(
      (await call("POST", `/api/tracks/${ids.flagged}/appeals`, tokens.fan, { message: "Not my track but whatever" }))
        .status,
    ).toBe(404);
    const appeal = await call<{ id: string }>("POST", `/api/tracks/${ids.flagged}/appeals`, tokens.prompter, {
      message: "We played every note of this ourselves; the tag came from a template.",
    });
    expect(appeal.status).toBe(201);
    expect(
      (await call("POST", `/api/tracks/${ids.flagged}/appeals`, tokens.prompter, { message: "And again, please look" }))
        .status,
    ).toBe(409);

    expect((await call("GET", "/api/admin/appeals", tokens.band)).status).toBe(403);
    const queue = await call<AdminAppeal[]>("GET", "/api/admin/appeals", tokens.admin);
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0]!.track).toMatchObject({ declaredScore: 0, aiScore: 100 });

    const resolved = await call("POST", `/api/admin/appeals/${appeal.body.id}/resolve`, tokens.admin, {
      decision: "upheld",
    });
    expect(resolved.status).toBe(200);
    const track = await call<TrackDetail>("GET", `/api/tracks/${ids.flagged}`, tokens.prompter);
    expect(track.body).toMatchObject({ aiScore: 0, scoreSource: "review", flagged: false, reviewScore: 0 });
    expect(track.body.appeal?.status).toBe("upheld");

    // Then an audit finds it was AI after all.
    await call("POST", `/api/admin/tracks/${ids.flagged}/review`, tokens.admin, { score: 100 });
    expect((await call<TrackDetail>("GET", `/api/tracks/${ids.flagged}`)).body.aiScore).toBe(100);
  });

  it("splits a track's money between band members", async () => {
    const bad = await call("PUT", `/api/tracks/${ids.human}/splits`, tokens.band, {
      splits: [{ email: "band@trusic.test", shareBps: 5000 }],
    });
    expect(bad.status).toBe(400);
    const ok = await call<{ email: string; shareBps: number }[]>(
      "PUT",
      `/api/tracks/${ids.human}/splits`,
      tokens.band,
      {
        splits: [
          { email: "band@trusic.test", shareBps: 7500 },
          { email: "drummer@trusic.test", shareBps: 2500 },
        ],
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.map((s) => [s.email, s.shareBps])).toEqual([
      ["band@trusic.test", 7500],
      ["drummer@trusic.test", 2500],
    ]);
  });

  it("runs user-centric, human-weighted payouts end to end", async () => {
    const sub = await call<{ priceMinor: number }>("POST", "/api/billing/subscribe", tokens.fan);
    expect(sub.status).toBe(200);
    const price = sub.body.priceMinor;

    // The fan mostly plays AI music, plus a few human tracks. Short plays don't count.
    await listen(tokens.fan!, ids.ai!, 6);
    await listen(tokens.fan!, ids.human!, 2);
    await listen(tokens.fan!, ids.human!, 3, 10_000);
    await listen(tokens.fan!, ids.flagged!, 2);
    // A free listener's plays count towards the human pot's split, not towards anyone's money.
    await listen(tokens.drummer!, ids.ai!, 1);

    const period = currentPeriod();
    expect((await call("POST", "/api/admin/payouts/run", tokens.band, { period })).status).toBe(403);
    const run = await call<PayoutRunSummary>("POST", "/api/admin/payouts/run", tokens.admin, { period });
    expect(run.status).toBe(200);

    const platform = Math.round(price * 0.2);
    expect(run.body.totals).toMatchObject({
      revenue: price,
      platform,
      paidToArtists: price - platform,
      carriedForward: 0,
    });
    expect(run.body.byLabel.ai_generated.amount).toBe(0);
    expect(run.body.byLabel.human.amount).toBe(price - platform);
    expect(run.body.totals.forfeitedByAi).toBeGreaterThan(0);

    // Where the fan's money went: all of the artist share to the one human track they played.
    const statements = await call<ListenerStatementView[]>("GET", "/api/me/statements", tokens.fan);
    expect(statements.body).toHaveLength(1);
    const s = statements.body[0]!;
    expect(s.artistShare).toBe(price - platform);
    const byTitle = Object.fromEntries(s.allocations.map((a) => [a.track.title, a]));
    expect(byTitle["Garage Anthem"]).toMatchObject({ streams: 2, amount: price - platform });
    expect(byTitle["Prompt Pop"]).toMatchObject({ streams: 6, amount: 0 });
    expect(byTitle["Prompt Pop"]!.baseAmount).toBeGreaterThan(0);

    // The band and their drummer split it 75/25.
    const bandEarnings = await call<EarningsPeriod[]>("GET", "/api/me/earnings", tokens.band);
    const drummerEarnings = await call<EarningsPeriod[]>("GET", "/api/me/earnings", tokens.drummer);
    expect(bandEarnings.body[0]!.amount + drummerEarnings.body[0]!.amount).toBe(price - platform);
    expect(Math.abs(bandEarnings.body[0]!.amount - 3 * drummerEarnings.body[0]!.amount)).toBeLessThanOrEqual(3);
    expect(bandEarnings.body[0]!.tracks[0]!.uplift).toBeGreaterThan(0);
    expect((await call<EarningsPeriod[]>("GET", "/api/me/earnings", tokens.prompter)).body).toEqual([]);

    const transparency = await call<Transparency>("GET", "/api/transparency");
    expect(transparency.body).toMatchObject({ platformSharePercent: 20, minStreamSeconds: 30 });
    expect(transparency.body.catalog).toEqual({ human: 1, ai_assisted: 0, ai_generated: 2 });
    expect(transparency.body.runs).toHaveLength(1);

    // Re-running a period replaces it rather than paying twice.
    await call("POST", "/api/admin/payouts/run", tokens.admin, { period });
    expect((await call<Transparency>("GET", "/api/transparency")).body.runs).toHaveLength(1);
  });

  it("removes a track from listings but keeps it on statements", async () => {
    expect((await call("DELETE", `/api/tracks/${ids.human}`, tokens.fan)).status).toBe(404);
    expect((await call("DELETE", `/api/tracks/${ids.human}`, tokens.band)).status).toBe(204);
    expect((await call<TrackList>("GET", "/api/tracks?label=human")).body.total).toBe(0);
    expect((await call("GET", `/api/tracks/${ids.human}`)).status).toBe(404);
    const statements = await call<ListenerStatementView[]>("GET", "/api/me/statements", tokens.fan);
    expect(statements.body[0]!.allocations.some((a) => a.track.title === "Garage Anthem")).toBe(true);
  });
});
