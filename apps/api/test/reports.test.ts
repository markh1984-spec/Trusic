import type {
  AdminCopyrightStrike,
  AdminReport,
  Balance,
  ListenerStatementView,
  MyTakedown,
  MyTakedowns,
  PayoutRunSummary,
  PlaylistDetail,
  ReleaseDetail,
  ReporterView,
  ReportReceipt,
  ReportTarget,
  StreamUrl,
  SuspendedAccount,
  TrackDetail,
  TrackList,
} from "@trusic/client";
import { AI_LABELS } from "@trusic/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tracks as tracksTable } from "../src/db/schema";
import { currentPeriod, previousPeriod } from "../src/payout-service";
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
let admin: { token: string; id: string };
let uploader: { token: string; id: string };
let other: { token: string; id: string };
let fan: { token: string; id: string };
let artistId: string;
let otherArtistId: string;
const ids: Record<string, string> = {};
const period = currentPeriod();

async function upload(token: string, artist: string, title: string) {
  const res = await sendFile(
    t,
    "POST",
    "/api/tracks",
    token,
    { artistId: artist, title, declaration: JSON.stringify(declaration()) },
    { name: "audio", filename: `${title}.wav`, data: wav() },
  );
  return (res.body as TrackDetail).id;
}

const notice = {
  role: "owner",
  claimantName: "Rita Rights",
  organisation: "Rights Ltd",
  address: "1 High Street, Leeds LS1 1AA",
  work: '"The Original" by Rita Rights, released 2020.',
  goodFaith: true,
  accurate: true,
  signature: "Rita Rights",
} as const;

/** Send a report, each from a different address so the per-address limit on reports doesn't get in the way. */
let reportsSent = 0;
async function fileReport<T = unknown>(token: string | undefined, body: object) {
  reportsSent += 1;
  const res = await t.app.inject({
    method: "POST",
    url: "/api/reports",
    headers: { "x-forwarded-for": `10.1.0.${reportsSent}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    payload: body,
  });
  return { status: res.statusCode, body: res.json() as T };
}

function copyrightReport(targetId: string, targetType = "track", token?: string) {
  return fileReport<ReportReceipt>(token, {
    targetType,
    targetId,
    reason: "copyright",
    details: "This is a straight copy of our recording.",
    reporterEmail: "rita@rights.test",
    copyright: notice,
  });
}

const act = (reportId: string, action: string, note: string) =>
  call<AdminReport>(t, "POST", `/api/admin/reports/${reportId}/${action}`, admin.token, { note });
const takeDown = (reportId: string) => act(reportId, "take-down", "It copies the claimant's recording.");

beforeAll(async () => {
  t = await createTestApp();
  admin = await register(t, ADMIN_EMAIL);
  uploader = await register(t, "uploader@trusic.test");
  other = await register(t, "other@trusic.test");
  fan = await register(t, "fan@trusic.test");
  await call(t, "POST", "/api/billing/subscribe", fan.token);

  artistId = (await call<{ id: string }>(t, "POST", "/api/artists", uploader.token, { name: "Copycat" })).body.id;
  otherArtistId = (await call<{ id: string }>(t, "POST", "/api/artists", other.token, { name: "Honest" })).body.id;
  for (const title of ["Copied", "Second", "Third", "Fourth"])
    ids[title] = await upload(uploader.token, artistId, title);
  ids.honest = await upload(other.token, otherArtistId, "Honest Song");
});
afterAll(async () => {
  await t?.close();
});

describe("reporting", () => {
  it("describes what's being reported, artwork included", async () => {
    const res = await call<ReportTarget>(t, "GET", `/api/report-targets/track/${ids.Copied}`);
    expect(res.body).toMatchObject({ type: "track", title: "Copied by Copycat", path: `/track/${ids.Copied}` });
    const slug = await call<ReportTarget>(t, "GET", "/api/report-targets/artist/copycat");
    expect(slug.body.id).toBe(artistId);
    expect((await call(t, "GET", "/api/report-targets/track/not-a-track")).status).toBe(404);
  });

  it("checks what a report needs", async () => {
    const noEmail = await fileReport<{ error: string }>(undefined, {
      targetType: "track",
      targetId: ids.Copied,
      reason: "offensive",
      details: "Something nasty in the title.",
    });
    expect(noEmail.status).toBe(400);
    expect(noEmail.body.error).toMatch(/email address/);

    const noNotice = await fileReport(undefined, {
      targetType: "track",
      targetId: ids.Copied,
      reason: "copyright",
      details: "Copied from me.",
      reporterEmail: "rita@rights.test",
    });
    expect(noNotice.status).toBe(400);

    const unticked = await fileReport<{ error: string }>(undefined, {
      targetType: "track",
      targetId: ids.Copied,
      reason: "copyright",
      details: "Copied from me.",
      reporterEmail: "rita@rights.test",
      copyright: { ...notice, goodFaith: false },
    });
    expect(unticked.status).toBe(400);
    expect(unticked.body.error).toMatch(/good-faith/);

    const labelOnRelease = await fileReport(fan.token, {
      targetType: "artist",
      targetId: artistId,
      reason: "ai_label",
      details: "This artist is all AI really.",
    });
    expect(labelOnRelease.status).toBe(400);
  });

  it("lets anyone report, and tells the reporter and admins", async () => {
    const res = await copyrightReport(ids.Copied!);
    expect(res.status).toBe(201);
    expect(res.body.reference).toBe(res.body.id.slice(0, 8).toUpperCase());
    ids.report = res.body.id;
    const ack = await lastEmail(t, "rita@rights.test", /received your report/);
    expect(ack.text).toContain(res.body.reference);
    const alert = await lastEmail(t, ADMIN_EMAIL, /New report: Copyright infringement/);
    expect(alert.text).toContain("https://trusic.test/admin#reports");

    const queue = await call<AdminReport[]>(t, "GET", "/api/admin/reports?queue=action&kind=takedown", admin.token);
    const listed = queue.body.find((r) => r.id === ids.report)!;
    expect(listed).toMatchObject({
      reason: "copyright",
      status: "open",
      targetState: "live",
      copyright: { claimantName: "Rita Rights", goodFaith: true, accurate: true },
      owner: { email: "uploader@trusic.test", copyrightStrikes: 0 },
    });
    expect((await call(t, "GET", "/api/admin/reports", fan.token)).status).toBe(403);
  });

  it("asks the reporter for more, and takes their answer from the emailed link", async () => {
    const asked = await act(ids.report!, "request-info", "Which part of the track do you say is copied?");
    expect(asked.body.status).toBe("needs_info");
    const mail = await lastEmail(t, "rita@rights.test", /more information/);
    const url = new URL(linkIn(mail, "https://trusic.test/report/reply/"));
    const token = url.searchParams.get("token")!;

    expect((await call(t, "GET", `/api/reports/${ids.report}/reply?token=wrong`)).status).toBe(404);
    const view = await call<ReporterView>(t, "GET", `/api/reports/${ids.report}/reply?token=${token}`);
    expect(view.body).toMatchObject({ canReply: true, question: "Which part of the track do you say is copied?" });

    const reply = await call<ReporterView>(t, "POST", `/api/reports/${ids.report}/reply`, undefined, {
      token,
      message: "All of it: it's our master recording.",
    });
    expect(reply.body.status).toBe("open");
    await lastEmail(t, ADMIN_EMAIL, /Reply to report/);
    const report = (await call<AdminReport[]>(t, "GET", "/api/admin/reports?queue=action", admin.token)).body.find(
      (r) => r.id === ids.report,
    )!;
    expect(report.messages.map((m) => [m.kind, m.from])).toEqual([
      ["info_request", "trusic"],
      ["reporter_reply", "reporter"],
    ]);
  });
});

describe("takedowns", () => {
  let streamUrl: string;
  let runBefore: PayoutRunSummary;

  beforeAll(async () => {
    // The fan plays the copied track three times and an honest one once, in a month that isn't finalised.
    for (let i = 0; i < 3; i++)
      await call(t, "POST", "/api/plays", fan.token, { trackId: ids.Copied, msPlayed: 35_000 });
    await call(t, "POST", "/api/plays", fan.token, { trackId: ids.honest, msPlayed: 35_000 });
    runBefore = (await call<PayoutRunSummary>(t, "POST", "/api/admin/payouts/run", admin.token, { period })).body;
    streamUrl = (await call<StreamUrl>(t, "GET", `/api/tracks/${ids.Copied}/stream`, fan.token)).body.url;
    expect((await t.app.inject({ method: "GET", url: streamUrl })).statusCode).toBe(200);
  });

  it("takes a track down: hidden everywhere, not streamable, a copyright strike, and emails", async () => {
    const res = await takeDown(ids.report!);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "taken_down", targetState: "taken_down" });

    const list = (await call<TrackList>(t, "GET", "/api/tracks")).body.tracks.map((t) => t.id);
    expect(list).not.toContain(ids.Copied);
    expect((await call(t, "GET", `/api/tracks/${ids.Copied}`, fan.token)).status).toBe(404);
    expect((await call(t, "GET", `/api/tracks/${ids.Copied}`, uploader.token)).status).toBe(200);
    expect((await call(t, "GET", `/api/tracks/${ids.Copied}/stream`, fan.token)).status).toBe(404);
    // Links handed out before the takedown stop working too.
    expect((await t.app.inject({ method: "GET", url: streamUrl })).statusCode).toBe(404);

    const mail = await lastEmail(t, "uploader@trusic.test", /We've taken down/);
    expect(mail.text).toContain("It copies the claimant's recording.");
    expect(mail.text).toContain(`https://trusic.test/takedown/${ids.report}`);
    expect(mail.text).toContain("copyright strike. You now have 1 of 3");
    await lastEmail(t, "rita@rights.test", /we've taken it down/);

    const mine = (await call<MyTakedowns>(t, "GET", "/api/me/takedowns", uploader.token)).body;
    expect(mine.copyrightStrikes).toHaveLength(1);
    expect(mine.takedowns[0]).toMatchObject({
      status: "taken_down",
      claimant: { name: "Rita Rights", organisation: "Rights Ltd" },
    });
    // The uploader doesn't see the claimant's contact details, or what the claimant and Trusic said to each other.
    expect(JSON.stringify(mine)).not.toContain("rita@rights.test");
    expect(JSON.stringify(mine)).not.toContain("High Street");
    expect(mine.takedowns[0]!.messages.map((m) => m.kind)).toEqual(["taken_down"]);
    // Copyright strikes are kept apart from strikes for false AI declarations.
    expect((await call<Balance>(t, "GET", "/api/me/balance", uploader.token)).body.strikes).toHaveLength(0);
  });

  it("stops paying a taken-down track in months not yet finalised", async () => {
    const run = (await call<{ runs: PayoutRunSummary[] }>(t, "GET", "/api/transparency")).body.runs.find(
      (r) => r.period === period,
    )!;
    // Same money in, but all of the fan's artist share now goes to the honest track they played.
    expect(run.totals.revenue).toBe(runBefore.totals.revenue);
    expect(run.totals.streams).toBe(runBefore.totals.streams - 3);
    const [statement] = (await call<ListenerStatementView[]>(t, "GET", "/api/me/statements", fan.token)).body;
    expect(statement!.allocations.map((a) => a.track.id)).toEqual([ids.honest]);
    expect(statement!.allocations[0]!.amount).toBe(statement!.artistShare);
    expect((await call<Balance>(t, "GET", "/api/me/balance", uploader.token)).body.balance).toBe(0);
  });

  it("keeps a taken-down track down even if its uploader removes it", async () => {
    expect((await call(t, "DELETE", `/api/tracks/${ids.Copied}`, uploader.token)).status).toBe(204);
    const [row] = await t.database.db.select().from(tracksTable).where(eq(tracksTable.id, ids.Copied!));
    expect(row!.status).toBe("taken_down");
  });

  it("takes a counter-notice, and an admin can put the track back", async () => {
    const tooShort = await call(t, "POST", `/api/me/takedowns/${ids.report}/counter-notice`, uploader.token, {
      name: "Cat Copy",
      explanation: "Mine.",
      goodFaith: true,
      consentToShare: true,
    });
    expect(tooShort.status).toBe(400);
    expect(
      (
        await call(t, "POST", `/api/me/takedowns/${ids.report}/counter-notice`, other.token, {
          name: "Not Them",
          explanation: "I want to dispute someone else's takedown.",
          goodFaith: true,
          consentToShare: true,
        })
      ).status,
    ).toBe(404);

    const sent = await call<MyTakedown>(t, "POST", `/api/me/takedowns/${ids.report}/counter-notice`, uploader.token, {
      name: "Cat Copy",
      explanation: "I recorded this myself in 2018 and have the session files to prove it.",
      goodFaith: true,
      consentToShare: true,
    });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("counter_notice");
    await lastEmail(t, ADMIN_EMAIL, /Counter-notice/);
    const toClaimant = await lastEmail(t, "rita@rights.test", /disputed your report/);
    expect(toClaimant.text).toContain("session files");
    expect(toClaimant.text).toContain("uploader@trusic.test");
    expect(linkIn(toClaimant, "https://trusic.test/report/reply/")).toContain("token=");

    const restored = await act(ids.report!, "restore", "The uploader showed us the original session files.");
    expect(restored.body).toMatchObject({ status: "restored", targetState: "live" });
    expect((await call(t, "GET", `/api/tracks/${ids.Copied}`, fan.token)).status).toBe(200);
    expect((await call(t, "GET", `/api/tracks/${ids.Copied}/stream`, fan.token)).status).toBe(200);
    await lastEmail(t, "uploader@trusic.test", /is back on Trusic/);
    await lastEmail(t, "rita@rights.test", /has been put back/);

    // The strike is withdrawn, and the track earns again in the open month.
    const mine = (await call<MyTakedowns>(t, "GET", "/api/me/takedowns", uploader.token)).body;
    expect(mine.copyrightStrikes[0]!.withdrawn).toBe(true);
    const [statement] = (await call<ListenerStatementView[]>(t, "GET", "/api/me/statements", fan.token)).body;
    expect(statement!.allocations.map((a) => a.track.id).sort()).toEqual([ids.Copied, ids.honest].sort());
    expect((await call<Balance>(t, "GET", "/api/me/balance", uploader.token)).body.balance).toBeGreaterThan(0);
  });

  it("leaves a finalised month as it was", async () => {
    const last = previousPeriod(period);
    await call(t, "POST", "/api/admin/payouts/run", admin.token, { period: last });
    await call(t, "POST", `/api/admin/payouts/${period}/finalize`, admin.token);
    const before = (await call<Balance>(t, "GET", "/api/me/balance", uploader.token)).body;

    const report = await copyrightReport(ids.Copied!);
    await takeDown(report.body.id);
    const after = (await call<Balance>(t, "GET", "/api/me/balance", uploader.token)).body;
    expect(after.balance).toBe(before.balance);
    const finalised = (await call<{ runs: PayoutRunSummary[] }>(t, "GET", "/api/transparency")).body.runs.find(
      (r) => r.period === period,
    )!;
    expect(finalised.totals.streams).toBe(runBefore.totals.streams);
    ids.secondReport = report.body.id;
  });

  it("keeps content down when an admin turns down the counter-notice", async () => {
    await call(t, "POST", `/api/me/takedowns/${ids.secondReport}/counter-notice`, uploader.token, {
      name: "Cat Copy",
      explanation: "Same again: this one is mine as well, honestly.",
      goodFaith: true,
      consentToShare: true,
    });
    const kept = await act(ids.secondReport!, "keep-down", "The claimant sent proof of the original release.");
    expect(kept.body.status).toBe("taken_down");
    await lastEmail(t, "uploader@trusic.test", /will stay down/);
    const again = await call(t, "POST", `/api/me/takedowns/${ids.secondReport}/counter-notice`, uploader.token, {
      name: "Cat Copy",
      explanation: "Trying a second counter-notice on the same takedown.",
      goodFaith: true,
      consentToShare: true,
    });
    expect(again.status).toBe(409);
  });

  it("suspends an account at three copyright strikes, counted apart from AI strikes", async () => {
    for (const title of ["Second", "Third"]) {
      const report = await copyrightReport(ids[title]!);
      await takeDown(report.body.id);
    }
    const mail = await lastEmail(t, "uploader@trusic.test", /We've taken down "Third/);
    expect(mail.text).toContain("You now have 3 of 3");
    expect(mail.text).toContain("your account is suspended");

    // Suspended through the usual mechanism: remaining tracks hidden, no uploads.
    const fourth = await call(t, "GET", `/api/tracks/${ids.Fourth}`, fan.token);
    expect(fourth.status).toBe(200);
    expect((await call(t, "GET", `/api/tracks/${ids.Fourth}/stream`, fan.token)).status).toBe(404);
    const refused = await sendFile(
      t,
      "POST",
      "/api/tracks",
      uploader.token,
      { artistId, title: "More", declaration: JSON.stringify(declaration()) },
      { name: "audio", filename: "more.wav", data: wav() },
    );
    expect(refused.status).toBe(403);

    const suspended = (await call<SuspendedAccount[]>(t, "GET", "/api/admin/suspended", admin.token)).body;
    expect(suspended.find((s) => s.id === uploader.id)).toMatchObject({ strikes: 0, copyrightStrikes: 3 });
    const strikes = (await call<AdminCopyrightStrike[]>(t, "GET", "/api/admin/copyright-strikes", admin.token)).body;
    expect(strikes.filter((s) => s.user.id === uploader.id)).toHaveLength(4);
    expect(strikes.filter((s) => s.user.id === uploader.id && !s.strike.withdrawn)).toHaveLength(3);

    // Reinstating uses the existing route; taken-down tracks stay down.
    await call(t, "POST", `/api/admin/users/${uploader.id}/reinstate`, admin.token);
    expect((await call(t, "GET", `/api/tracks/${ids.Fourth}/stream`, fan.token)).status).toBe(200);
    expect((await call(t, "GET", `/api/tracks/${ids.Third}/stream`, fan.token)).status).toBe(404);
  });

  it("rejects a report and tells the reporter why", async () => {
    const report = await fileReport<ReportReceipt>(undefined, {
      targetType: "track",
      targetId: ids.honest,
      reason: "offensive",
      details: "I just don't like this song at all.",
      reporterEmail: "grumpy@trusic.test",
    });
    const rejected = await act(report.body.id, "reject", "Not liking a song isn't against our rules.");
    expect(rejected.body.status).toBe("rejected");
    const mail = await lastEmail(t, "grumpy@trusic.test", /we haven't taken it down/);
    expect(mail.text).toContain("Not liking a song");
    expect((await act(report.body.id, "take-down", "Changed my mind about this.")).status).toBe(409);
    expect((await call(t, "GET", `/api/tracks/${ids.honest}`)).status).toBe(200);
  });
});

describe("taking down releases, artists, playlists and artwork", () => {
  let releaseId: string;
  let releaseTrack: string;
  let artworkName: string;

  beforeAll(async () => {
    releaseId = (
      await call<ReleaseDetail>(t, "POST", "/api/releases", other.token, {
        artistId: otherArtistId,
        title: "Rude Album",
        type: "album",
      })
    ).body.id;
    releaseTrack = await upload(other.token, otherArtistId, "Album Track");
    await call(t, "PUT", `/api/releases/${releaseId}/tracks`, other.token, { trackIds: [releaseTrack] });
    const withArt = await sendFile(
      t,
      "PUT",
      `/api/releases/${releaseId}/artwork`,
      other.token,
      {},
      {
        name: "image",
        filename: "cover.png",
        data: png(5),
        contentType: "image/png",
      },
    );
    artworkName = (withArt.body as ReleaseDetail).artworkUrl!.split("/").pop()!;
  });

  it("takes artwork off on its own, and puts it back", async () => {
    const target = (await call<ReportTarget>(t, "GET", `/api/report-targets/release/${releaseId}`)).body;
    expect(target.artwork?.name).toBe(artworkName);
    const report = await fileReport<ReportReceipt>(fan.token, {
      targetType: "artwork",
      targetId: artworkName,
      reason: "offensive",
      details: "The cover is a graphic, violent image.",
    });
    expect(report.status).toBe(201);
    await takeDown(report.body.id);
    const release = (await call<ReleaseDetail>(t, "GET", `/api/releases/${releaseId}`)).body;
    expect(release.artworkUrl).toBeNull();
    expect(release.tracks).toHaveLength(1);

    await act(report.body.id, "restore", "On a second look the cover is fine.");
    expect((await call<ReleaseDetail>(t, "GET", `/api/releases/${releaseId}`)).body.artworkUrl).toContain(artworkName);
  });

  it("takes a release down with its tracks", async () => {
    const report = await fileReport<ReportReceipt>(fan.token, {
      targetType: "release",
      targetId: releaseId,
      reason: "offensive",
      details: "The album title is a slur.",
    });
    await takeDown(report.body.id);
    expect((await call(t, "GET", `/api/releases/${releaseId}`)).status).toBe(404);
    expect((await call(t, "GET", `/api/tracks/${releaseTrack}`)).status).toBe(404);
    expect((await call(t, "GET", `/api/tracks/${ids.honest}`)).status).toBe(200);
    // Non-copyright takedowns aren't copyright strikes.
    const mine = (await call<MyTakedowns>(t, "GET", "/api/me/takedowns", other.token)).body;
    expect(mine.copyrightStrikes).toHaveLength(0);
    expect(mine.takedowns.map((d) => d.targetType)).toContain("release");
  });

  it("takes an impersonating artist down, while its owner can still see it", async () => {
    const report = await fileReport<ReportReceipt>(fan.token, {
      targetType: "artist",
      targetId: otherArtistId,
      reason: "impersonation",
      details: "This profile pretends to be a famous band.",
    });
    await takeDown(report.body.id);
    expect((await call(t, "GET", "/api/artists/honest")).status).toBe(404);
    expect((await call(t, "GET", "/api/artists/honest", other.token)).status).toBe(200);
    expect((await call(t, "GET", `/api/tracks/${ids.honest}`)).status).toBe(404);

    await act(report.body.id, "restore", "They showed us they are the band.");
    expect((await call(t, "GET", "/api/artists/honest")).status).toBe(200);
    expect((await call(t, "GET", `/api/tracks/${ids.honest}`)).status).toBe(200);
    // The release taken down separately stays down.
    expect((await call(t, "GET", `/api/releases/${releaseId}`)).status).toBe(404);
  });

  it("hides a playlist from everyone but its owner", async () => {
    const playlist = (await call<PlaylistDetail>(t, "POST", "/api/playlists", other.token, { name: "Offensive name" }))
      .body;
    const report = await fileReport<ReportReceipt>(fan.token, {
      targetType: "playlist",
      targetId: playlist.id,
      reason: "offensive",
      details: "The playlist name is hate speech.",
    });
    await takeDown(report.body.id);
    expect((await call(t, "GET", `/api/playlists/${playlist.id}`, fan.token)).status).toBe(404);
    expect((await call(t, "GET", `/api/playlists/${playlist.id}`, other.token)).status).toBe(200);
  });
});

describe("wrong AI labels", () => {
  it("go to the score review, not the takedown queue", async () => {
    const report = await fileReport<ReportReceipt>(fan.token, {
      targetType: "track",
      targetId: ids.honest,
      reason: "ai_label",
      details: "The vocals are obviously a voice model.",
    });
    expect(report.status).toBe(201);
    const takedowns = (await call<AdminReport[]>(t, "GET", "/api/admin/reports?kind=takedown", admin.token)).body;
    expect(takedowns.map((r) => r.id)).not.toContain(report.body.id);
    const labels = (await call<AdminReport[]>(t, "GET", "/api/admin/reports?kind=ai_label", admin.token)).body;
    const listed = labels.find((r) => r.id === report.body.id)!;
    expect(listed.track).toMatchObject({ id: ids.honest, aiScore: 0, declaredScore: 0 });
    expect((await takeDown(report.body.id)).status).toBe(400);

    const reviewed = await call<AdminReport>(
      t,
      "POST",
      `/api/admin/reports/${report.body.id}/label-review`,
      admin.token,
      { score: 25, note: "The vocals are generated." },
    );
    expect(reviewed.body.status).toBe("resolved");
    const track = (await call<TrackDetail>(t, "GET", `/api/tracks/${ids.honest}`)).body;
    expect(track).toMatchObject({ aiScore: 25, scoreSource: "review" });
    const mail = await lastEmail(t, "fan@trusic.test", /reviewed the AI label/);
    expect(mail.text).toContain(`"${AI_LABELS.ai_assisted.name}"`);
  });

  it("can issue a strike for a false declaration, as appeals can", async () => {
    const report = await fileReport<ReportReceipt>(fan.token, {
      targetType: "track",
      targetId: ids.honest,
      reason: "ai_label",
      details: "It's entirely generated, not just the vocals.",
    });
    await call(t, "POST", `/api/admin/reports/${report.body.id}/label-review`, admin.token, {
      score: 100,
      strike: true,
      note: "The whole track was generated.",
    });
    const balance = (await call<Balance>(t, "GET", "/api/me/balance", other.token)).body;
    expect(balance.strikes).toHaveLength(1);
    expect(balance.strikes[0]).toMatchObject({ correctedScore: 100 });
    expect((await call<MyTakedowns>(t, "GET", "/api/me/takedowns", other.token)).body.copyrightStrikes).toHaveLength(0);
    const mail = await lastEmail(t, "fan@trusic.test", /reviewed the AI label/);
    expect(mail.text).toContain(`"${AI_LABELS.ai_generated.name}"`);
  });
});

describe("abuse", () => {
  it("limits how many reports one address can send", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await t.app.inject({
        method: "POST",
        url: "/api/reports",
        headers: { "x-forwarded-for": "10.2.0.1" },
        payload: { targetType: "track", targetId: ids.honest, reason: "offensive", details: "Spam spam spam." },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
