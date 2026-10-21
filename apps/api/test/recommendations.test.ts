import type {
  HomeFeed,
  HumanOnlySetting,
  PlaylistDetail,
  RadioBatch,
  ReleaseSummary,
  SimilarArtists,
  SimilarTracks,
  TrackDetail,
  TrackList,
} from "@trusic/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { follows, likes, plays } from "../src/db/schema";
import { call, createTestApp, declaration, register, sendFile, wav, type TestApp } from "./helpers";

let t: TestApp;
const users: Record<string, { token: string; id: string }> = {};
const artists: Record<string, string> = {};
const ids: Record<string, string> = {};
const title = (id: string) => Object.entries(ids).find(([, v]) => v === id)?.[0];

const ALL_AI = declaration({
  composition: "generated",
  lyrics: "generated",
  vocals: "generated",
  instrumentation: "generated",
  production: "generated",
});

async function upload(owner: string, artist: string, key: string, genre: string, decl = declaration()) {
  const res = await sendFile(
    t,
    "POST",
    "/api/tracks",
    users[owner]!.token,
    { artistId: artists[artist]!, title: key, genre, declaration: JSON.stringify(decl) },
    { name: "audio", filename: `${key}.wav`, data: wav({ seconds: 6, seed: key.length }) },
  );
  expect(res.status).toBe(201);
  ids[key] = (res.body as TrackDetail).id;
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

beforeAll(async () => {
  t = await createTestApp();
  for (const name of ["pines", "mara", "neon", "harbour", "lonely", "u1", "u2", "u3", "u4", "u5"]) {
    users[name] = await register(t, `${name}@trusic.test`);
  }
  for (const [owner, name] of [
    ["pines", "Pines"],
    ["mara", "Mara"],
    ["neon", "Neon"],
    ["harbour", "Harbour"],
    ["lonely", "Lonely"],
  ] as const) {
    artists[name] = (await call<{ id: string }>(t, "POST", "/api/artists", users[owner]!.token, { name })).body.id;
  }
  await upload("pines", "Pines", "P1", "Folk");
  await upload("pines", "Pines", "P2", "Folk");
  await upload("mara", "Mara", "M1", "Singer-Songwriter");
  await upload("neon", "Neon", "N1", "Pop", ALL_AI);
  await upload("neon", "Neon", "N2", "Pop", ALL_AI);
  await upload("harbour", "Harbour", "H1", "Electronic");
  await upload("lonely", "Lonely", "L1", "Folk");

  // Who streams what. Everyone who plays P1 plays something else too; N1 (AI) is the most shared.
  const listening: Record<string, string[]> = {
    u1: ["P1", "P2", "M1"],
    u2: ["P1", "M1", "N1"],
    u3: ["P1", "N1", "N2"],
    u4: ["H1"],
    u5: ["P1", "N1"],
  };
  let n = 0;
  await t.database.db.insert(plays).values(
    Object.entries(listening).flatMap(([user, keys]) =>
      keys.map((key) => ({
        userId: users[user]!.id,
        trackId: ids[key]!,
        msPlayed: 45_000,
        aiScore: 0,
        playedAt: minutesAgo(60 - n++),
      })),
    ),
  );
  // Short plays don't count as listening.
  await t.database.db
    .insert(plays)
    .values({ userId: users.u4!.id, trackId: ids.P1!, msPlayed: 5_000, aiScore: 0, playedAt: minutesAgo(1) });
  await t.database.db.insert(likes).values({ userId: users.u1!.id, trackId: ids.P1! });
  await t.database.db.insert(follows).values({ userId: users.u1!.id, artistId: artists.Mara! });
});
afterAll(async () => {
  await t?.close();
});

describe("the Human-made only switch", () => {
  it("is kept on the account and filters browsing and search", async () => {
    const u1 = users.u1!.token;
    expect((await call<HumanOnlySetting>(t, "GET", "/api/me/human-only", u1)).body).toEqual({ humanOnly: false });
    const all = await call<TrackList>(t, "GET", "/api/tracks", u1);
    expect(all.body.total).toBe(7);

    expect((await call<HumanOnlySetting>(t, "PUT", "/api/me/human-only", u1, { humanOnly: true })).body).toEqual({
      humanOnly: true,
    });
    const human = await call<TrackList>(t, "GET", "/api/tracks", u1);
    expect(human.body.tracks.every((x) => x.aiLabel === "human")).toBe(true);
    expect(human.body.total).toBe(5);
    expect((await call<TrackList>(t, "GET", "/api/tracks?q=Neon", u1)).body.total).toBe(0);
    // An app can override it, and visitors (no account) choose it per request.
    expect((await call<TrackList>(t, "GET", "/api/tracks?humanOnly=0", u1)).body.total).toBe(7);
    expect((await call<TrackList>(t, "GET", "/api/tracks?humanOnly=1")).body.total).toBe(5);
    expect((await call<TrackList>(t, "GET", "/api/tracks")).body.total).toBe(7);
    await call(t, "PUT", "/api/me/human-only", u1, { humanOnly: false });
    expect((await call(t, "PUT", "/api/me/human-only", undefined, { humanOnly: true })).status).toBe(401);
  });

  it("shows only all-human releases among new releases", async () => {
    for (const [owner, artist, name, keys] of [
      ["pines", "Pines", "Chalk", ["P1", "P2"]],
      ["neon", "Neon", "Content", ["N1"]],
    ] as const) {
      const r = await call<{ id: string }>(t, "POST", "/api/releases", users[owner]!.token, {
        artistId: artists[artist],
        title: name,
        type: "ep",
      });
      await call(t, "PUT", `/api/releases/${r.body.id}/tracks`, users[owner]!.token, {
        trackIds: keys.map((k) => ids[k]),
      });
    }
    const everything = await call<ReleaseSummary[]>(t, "GET", "/api/releases");
    expect(everything.body.map((r) => r.title).sort()).toEqual(["Chalk", "Content"]);
    const human = await call<ReleaseSummary[]>(t, "GET", "/api/releases?humanOnly=1");
    expect(human.body.map((r) => r.title)).toEqual(["Chalk"]);
  });
});

describe("more like this", () => {
  it("ranks by co-listening only, with no boost for any label, and says why", async () => {
    const res = await call<SimilarTracks>(t, "GET", `/api/recommendations/tracks/${ids.P1}`);
    expect(res.status).toBe(200);
    const got = res.body.tracks.map((r) => title(r.track.id));
    // N1 (AI Slop) is shared by three of P1's listeners, so it comes first: the label is never a ranking signal.
    expect(got.slice(0, 2)).toEqual(["N1", "M1"]);
    expect(res.body.tracks[0]!.reason).toBe("3 listeners of “P1” also play this");
    expect(got).not.toContain("P1");
    expect(res.body.why).toContain("Nobody can pay");
  });

  it("leaves out tracks that aren't Human-made when the switch is on", async () => {
    const res = await call<SimilarTracks>(t, "GET", `/api/recommendations/tracks/${ids.P1}?humanOnly=1`);
    expect(res.body.humanOnly).toBe(true);
    expect(res.body.tracks.map((r) => title(r.track.id)).slice(0, 2)).toEqual(["M1", "P2"]);
    expect(res.body.tracks.every((r) => r.track.aiLabel === "human")).toBe(true);
    expect(res.body.why).toContain("Human-made only is on");
  });

  it("falls back to the same artist, then genre, then what's popular, for a track nobody has played", async () => {
    const res = await call<SimilarTracks>(t, "GET", `/api/recommendations/tracks/${ids.L1}`);
    const reasons = res.body.tracks.map((r) => [title(r.track.id), r.reason]);
    expect(reasons[0]).toEqual([expect.stringMatching(/^P[12]$/), "Folk, like “L1”"]);
    expect(reasons.find(([key]) => key === "N1")?.[1]).toBe("Popular on Trusic in the last four weeks");
  });

  it("leaves the viewer's own listening out of the explanation", async () => {
    const res = await call<SimilarTracks>(t, "GET", `/api/recommendations/tracks/${ids.P1}`, users.u5!.token);
    expect(res.body.tracks[0]!.reason).toBe("2 listeners of “P1” also play this");
  });
});

describe("fans also like", () => {
  it("finds artists played by the same people", async () => {
    const res = await call<SimilarArtists>(t, "GET", `/api/recommendations/artists/${artists.Pines}`);
    expect(res.body.artists.map((a) => [a.artist.name, a.reason])).toEqual([
      ["Neon", "3 listeners in common with Pines"],
      ["Mara", "2 listeners in common with Pines"],
      ["Lonely", "Also Folk, like Pines"],
    ]);
    const human = await call<SimilarArtists>(t, "GET", `/api/recommendations/artists/${artists.Pines}?humanOnly=1`);
    expect(human.body.artists.map((a) => a.artist.name)).toEqual(["Mara", "Lonely"]);
    expect(human.body.artists[0]).toMatchObject({ tracks: 1, humanMadeTracks: 1 });
  });
});

describe("home page", () => {
  it("gives visitors popular, new and human-made shelves", async () => {
    const res = await call<HomeFeed>(t, "GET", "/api/recommendations/home");
    expect(res.body.personalised).toBe(false);
    const shelves = res.body.shelves.map((s) => s.id);
    expect(shelves).toEqual(
      expect.arrayContaining(["popular", "new-releases", "fresh-human-made", "artists-to-discover"]),
    );
    expect(shelves).not.toContain("jump-back-in");
    for (const shelf of res.body.shelves) expect(shelf.why.length).toBeGreaterThan(20);
    const fresh = res.body.shelves.find((s) => s.id === "fresh-human-made");
    expect(fresh?.kind === "tracks" && fresh.tracks.every((r) => r.track.aiLabel === "human")).toBe(true);
  });

  it("puts a listener's own shelves first", async () => {
    const res = await call<HomeFeed>(t, "GET", "/api/recommendations/home", users.u1!.token);
    expect(res.body.personalised).toBe(true);
    const byId = Object.fromEntries(res.body.shelves.map((s) => [s.id, s]));
    expect(res.body.shelves[0]!.id).toBe("jump-back-in");
    const tracksOf = (id: string) => {
      const shelf = byId[id];
      return shelf?.kind === "tracks" ? shelf.tracks.map((r) => title(r.track.id)) : [];
    };
    expect(tracksOf("jump-back-in")).toEqual(["M1", "P2", "P1"]);
    // Made for you is new music: nothing u1 already plays or likes.
    expect(tracksOf("made-for-you")[0]).toBe("N1");
    expect(tracksOf("made-for-you").some((k) => ["P1", "P2", "M1"].includes(k!))).toBe(false);
    expect(tracksOf("new-from-follows")).toEqual(["M1"]);
    expect(byId[`because-you-liked-${ids.P1}`]?.title).toBe("Because you liked “P1”");
  });

  it("keeps every shelf Human-made when the switch is on", async () => {
    const res = await call<HomeFeed>(t, "GET", "/api/recommendations/home?humanOnly=1", users.u1!.token);
    expect(res.body.humanOnly).toBe(true);
    for (const shelf of res.body.shelves) {
      if (shelf.kind === "tracks") expect(shelf.tracks.every((r) => r.track.aiLabel === "human")).toBe(true);
      if (shelf.kind === "artists") expect(shelf.artists.every((a) => a.humanMadeTracks > 0)).toBe(true);
      expect(shelf.why).toContain("Human-made only is on");
    }
  });
});

describe("radio", () => {
  it("starts with the track it's based on and never runs out", async () => {
    const played: string[] = [];
    const first = await call<RadioBatch>(t, "GET", `/api/radio?seed=track:${ids.P1}&limit=4`);
    expect(first.status).toBe(200);
    expect(first.body.name).toBe("P1 radio");
    expect(first.body.tracks[0]!.track.id).toBe(ids.P1);
    expect(first.body.tracks[1]!.track.id).toBe(ids.N1);
    played.push(...first.body.tracks.map((r) => r.track.id));
    for (let batch = 0; batch < 4; batch++) {
      const res = await call<RadioBatch>(
        t,
        "GET",
        `/api/radio?seed=track:${ids.P1}&limit=4&exclude=${played.join(",")}`,
      );
      expect(res.body.tracks.length).toBeGreaterThan(0);
      const recent = played.slice(-Math.min(10, Math.floor(played.length / 2)));
      for (const r of res.body.tracks) expect(recent).not.toContain(r.track.id);
      played.push(...res.body.tracks.map((r) => r.track.id));
    }
    // Seven tracks in the catalogue, twenty played: it went round again rather than stopping.
    expect(new Set(played).size).toBe(7);
  });

  it("mixes an artist's own tracks in every third track", async () => {
    const res = await call<RadioBatch>(t, "GET", `/api/radio?seed=artist:${artists.Pines}&limit=6`);
    const fromPines = res.body.tracks.map((r) => r.track.artist.name === "Pines");
    expect(fromPines.slice(0, 4)).toEqual([true, false, false, true]);
    expect(res.body.tracks[0]!.reason).toBe("From the artist this radio is based on");
  });

  it("plays only Human-made tracks after the first when the switch is on", async () => {
    const res = await call<RadioBatch>(t, "GET", `/api/radio?seed=track:${ids.N1}&humanOnly=1&limit=10`);
    expect(res.body.tracks[0]!.track.id).toBe(ids.N1);
    expect(res.body.tracks.slice(1).every((r) => r.track.aiLabel === "human")).toBe(true);
    expect(res.body.tracks.length).toBeGreaterThan(1);
  });

  it("only plays private playlists for their owner", async () => {
    const created = await call<PlaylistDetail>(t, "POST", "/api/playlists", users.u1!.token, {
      name: "Secret",
      isPublic: false,
    });
    await call(t, "POST", `/api/playlists/${created.body.id}/entries`, users.u1!.token, { trackIds: [ids.M1] });
    const seed = `seed=playlist:${created.body.id}`;
    expect((await call(t, "GET", `/api/radio?${seed}`, users.u2!.token)).status).toBe(404);
    const mine = await call<RadioBatch>(t, "GET", `/api/radio?${seed}`, users.u1!.token);
    expect(mine.body.name).toBe("Secret radio");
    expect(mine.body.tracks[0]!.track.id).toBe(ids.M1);
    expect((await call(t, "GET", "/api/radio?seed=album:123")).status).toBe(400);
  });
});
