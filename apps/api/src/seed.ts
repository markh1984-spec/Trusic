/**
 * Fill a local Trusic with demo data: human bands, an AI-assisted act, a
 * prompt-generated "artist", a flagged upload awaiting review, listeners with
 * six months of listening, and finished payout months.
 *
 *   pnpm seed           seed an empty database
 *   pnpm seed --reset   wipe local data first (embedded database only)
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import type { AiDeclaration, StageDeclaration } from "@trusic/core";
import { eq } from "drizzle-orm";
import { buildApp } from "./app";
import { createSession, hashPassword } from "./auth";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { follows, likes, plays, revenueEntries, users } from "./db/schema";
import { MetadataDetector } from "./detection";
import { createStripeClient } from "./routes/billing";
import { currentPeriod, finalizeRun, periodBounds, previousPeriod, runPayouts } from "./payout-service";
import {
  EXTRA_LISTENERS,
  extraTaste,
  seededRandom,
  simulateListening,
  TASTE_GROUPS,
  type DemoListener,
} from "./seed-listening";
import { LocalMediaStorage } from "./storage";
import { synthPng, synthWav } from "./synth";

// The seed creates accounts through the API, so it needs sign-ups open even where the live site has them closed.
const config = { ...loadConfig(), registrationOpen: true };
const PASSWORD = config.demoPassword;
if (PASSWORD.length < 8) throw new Error("DEMO_PASSWORD must be at least 8 characters.");

if (process.argv.includes("--reset")) {
  if (config.databaseUrl) throw new Error("--reset only works with the embedded database. Reset Postgres yourself.");
  await rm(config.dataDir, { recursive: true, force: true });
  console.log(`Removed ${config.dataDir}`);
}

const database = await openDatabase({ url: config.databaseUrl, dataDir: path.join(config.dataDir, "pglite") });
const { db } = database;
const app = await buildApp({
  db,
  storage: new LocalMediaStorage(path.join(config.dataDir, "media")),
  detector: new MetadataDetector(),
  config,
  stripe: createStripeClient(config),
});

const [existing] = await db.select({ id: users.id }).from(users).limit(1);
if (existing) {
  console.log("The database already has data. Run `pnpm seed --reset` to start again.");
  await app.close();
  await database.close();
  process.exit(0);
}

async function call<T>(method: string, url: string, token: string | null, body?: unknown): Promise<T> {
  const res = await app.inject({
    method: method as "POST",
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} failed: ${res.statusCode} ${res.body}`);
  return (res.body ? res.json() : null) as T;
}

let demoPasswordHash: string | null = null;
/** An account made straight in the database, because sign-ups through the API are rate limited. */
async function directAccount(email: string, displayName: string) {
  demoPasswordHash ??= await hashPassword(PASSWORD);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: demoPasswordHash, displayName })
    .returning({ id: users.id });
  return { id: user!.id, email, token: await createSession(db, user!.id) };
}

async function account(email: string, displayName: string) {
  const res = await call<{ token: string; user: { id: string } }>("POST", "/api/auth/register", null, {
    email,
    password: PASSWORD,
    displayName,
  });
  return { token: res.token, id: res.user.id, email };
}

const human = (
  overrides: Partial<Record<keyof AiDeclaration["stages"], StageDeclaration>> = {},
  extra: Partial<AiDeclaration> = {},
): AiDeclaration => ({
  stages: {
    composition: "none",
    lyrics: "none",
    vocals: "none",
    instrumentation: "none",
    production: "none",
    ...overrides,
  },
  assistiveTools: [],
  toolsUsed: [],
  ...extra,
});

const ALL_AI = human(
  {
    composition: "generated",
    lyrics: "generated",
    vocals: "generated",
    instrumentation: "generated",
    production: "generated",
  },
  { toolsUsed: ["Suno"] },
);

let seed = 1;
async function upload(
  owner: { token: string },
  artistId: string,
  title: string,
  genre: string,
  declaration: AiDeclaration,
  comment?: string,
) {
  const audio = synthWav({ seconds: 48 + (seed % 4) * 6, sampleRate: 16_000, seed: seed++, comment });
  const fields = { artistId, title, genre, declaration: JSON.stringify(declaration) };
  const track = await sendFile<{ id: string; aiScore: number }>("POST", "/api/tracks", owner.token, fields, {
    name: "audio",
    filename: `${title}.wav`,
    data: audio,
  });
  console.log(`  ${title.padEnd(26)} AI ${String(track.aiScore).padStart(3)}`);
  scores[track.id] = track.aiScore;
  return track.id;
}

/** Each track's AI score, recorded on the plays we simulate. */
const scores: Record<string, number> = {};

async function sendFile<T>(
  method: "POST" | "PUT",
  url: string,
  token: string,
  fields: Record<string, string>,
  file: { name: string; filename: string; data: Buffer },
): Promise<T> {
  const boundary = `----trusicseed${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.concat([
    ...Object.entries(fields).map(([k, v]) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} failed: ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

const image = (seedNumber: number) => ({ name: "image", filename: "image.png", data: synthPng({ seed: seedNumber }) });

const artist = (owner: { token: string }, name: string, bio: string) =>
  call<{ id: string }>("POST", "/api/artists", owner.token, { name, bio }).then((a) => a.id);

console.log("Creating accounts…");
const admin = await account("admin@trusic.local", "Trusic Admin");
await db.update(users).set({ isAdmin: true }).where(eq(users.email, admin.email));

const pines = await account("pines@trusic.local", "Ellie (The Hollow Pines)");
const pinesBass = await account("pines-bass@trusic.local", "Tom (The Hollow Pines)");
const pinesDrums = await account("pines-drums@trusic.local", "Sam (The Hollow Pines)");
const mara = await account("mara@trusic.local", "Mara Quinn");
const harbour = await account("harbour@trusic.local", "Static Harbour");
const velvet = await account("velvet@trusic.local", "Velvet Room");
const prompter = await account("prompter@trusic.local", "Neon Prompt");
const listeners = await Promise.all(
  ["listener", "jo", "priya", "dev", "alex", "kim"].map((n) =>
    account(`${n}@trusic.local`, n[0]!.toUpperCase() + n.slice(1)),
  ),
);

console.log("Uploading tracks…");
const pinesId = await artist(
  pines,
  "The Hollow Pines",
  "Four-piece folk rock band from the South Downs. Everything you hear, we played in one room.",
);
const t: Record<string, string> = {};
t.pines1 = await upload(
  pines,
  pinesId,
  "Chalk Paths",
  "Folk Rock",
  human({}, { assistiveTools: ["mastering"], toolsUsed: ["LANDR"] }),
);
t.pines2 = await upload(pines, pinesId, "Harbour Lights", "Folk Rock", human());
t.pines3 = await upload(
  pines,
  pinesId,
  "The Long Field",
  "Folk",
  human({ vocals: "not_applicable", lyrics: "not_applicable" }),
);
const maraId = await artist(mara, "Mara Quinn", "Singer-songwriter. Piano, voice, and too many notebooks.");
t.mara1 = await upload(mara, maraId, "Paper Boats", "Singer-Songwriter", human());
t.mara2 = await upload(
  mara,
  maraId,
  "Second Language",
  "Singer-Songwriter",
  human({ lyrics: "assisted" }, { notes: "I used an AI rhyming dictionary on the second verse." }),
);
const harbourId = await artist(
  harbour,
  "Static Harbour",
  "Electronic duo. Synths, field recordings, and some AI sketching.",
);
t.harbour1 = await upload(
  harbour,
  harbourId,
  "Tidal Grid",
  "Electronic",
  human(
    { composition: "assisted", instrumentation: "generated", lyrics: "not_applicable", vocals: "not_applicable" },
    { assistiveTools: ["stem_separation", "mastering"] },
  ),
);
t.harbour2 = await upload(
  harbour,
  harbourId,
  "Low Tide Radio",
  "Electronic",
  human({ lyrics: "not_applicable", vocals: "not_applicable" }),
);
const velvetId = await artist(velvet, "Velvet Room", "Late-night soul. Our songs, sung by a voice model.");
t.velvet1 = await upload(
  velvet,
  velvetId,
  "After Hours",
  "Soul",
  human({ vocals: "generated" }, { toolsUsed: ["Voice model"] }),
);
const neonId = await artist(prompter, "Neon Prompt", "Endless bangers, freshly generated.");
t.neon1 = await upload(prompter, neonId, "Hyperdrive Summer", "Pop", ALL_AI);
t.neon2 = await upload(prompter, neonId, "Synthetic Hearts", "Pop", ALL_AI);
t.neon3 = await upload(prompter, neonId, "Midnight Algorithm", "Dance", ALL_AI);
// Declared human, but the file says otherwise.
t.neon4 = await upload(prompter, neonId, "Totally Real Band Song", "Rock", human(), "Created with Suno v5 - suno.com");

// More human artists, so recommendations have something to choose between.
const morrow = await directAccount("morrow@trusic.local", "Morrow Lane");
const morrowId = await artist(
  morrow,
  "Morrow Lane",
  "Indie folk trio from Bristol. Harmonies first, everything else second.",
);
t.morrow1 = await upload(morrow, morrowId, "Lantern Weather", "Folk", human());
t.morrow2 = await upload(
  morrow,
  morrowId,
  "Small Hours",
  "Singer-Songwriter",
  human({}, { assistiveTools: ["mastering"] }),
);
const kiln = await directAccount("kiln@trusic.local", "Kiln");
const kilnId = await artist(kiln, "Kiln", "Modular synths and tape loops, made in an old pottery in Stoke.");
const instrumental = { lyrics: "not_applicable", vocals: "not_applicable" } as const;
t.kiln1 = await upload(kiln, kilnId, "Glaze", "Electronic", human(instrumental));
t.kiln2 = await upload(kiln, kilnId, "Firing Order", "Electronic", human({ ...instrumental, composition: "assisted" }));
const ada = await directAccount("ada@trusic.local", "Ada Brightwater");
const adaId = await artist(ada, "Ada Brightwater", "Jazz and soul singer, recorded live with a five-piece band.");
t.ada1 = await upload(ada, adaId, "Blue Hour", "Soul", human());
t.ada2 = await upload(ada, adaId, "Northern Line", "Jazz", human());

await call("POST", `/api/tracks/${t.neon4}/appeals`, prompter.token, {
  message: "We wrote and played this ourselves. The tag must have come from a template we used.",
});
await call("PUT", `/api/tracks/${t.pines1}/splits`, pines.token, {
  splits: [
    { email: pines.email, shareBps: 4000 },
    { email: pinesBass.email, shareBps: 3000 },
    { email: pinesDrums.email, shareBps: 3000 },
  ],
});

// Songwriting details, so the admin rights summary has something to show.
const credit = (
  songwriters: string[],
  societyMember: "yes" | "no" | "unsure",
  isCover = false,
  originalArtist?: string,
) => ({
  songwriters,
  societyMember,
  isCover,
  ...(originalArtist ? { originalArtist } : {}),
});
for (const [owner, key, credits] of [
  [pines, "pines1", credit(["Ellie Marsh", "Tom Reid"], "yes")],
  [pines, "pines2", credit(["Ellie Marsh"], "yes")],
  [pines, "pines3", credit(["Sam Okafor"], "no")],
  [mara, "mara1", credit(["Mara Quinn"], "no")],
  [mara, "mara2", credit(["Mara Quinn"], "no")],
  [harbour, "harbour2", credit(["Jo Hart", "Lee Hart"], "unsure")],
  [velvet, "velvet1", credit(["Dee Lawson"], "yes")],
] as const) {
  await call("PUT", `/api/tracks/${t[key]}/credits`, owner.token, credits);
}

console.log("Creating releases and libraries…");
const releaseIds: Record<string, string> = {};
async function release(
  owner: { token: string },
  artistId: string,
  title: string,
  type: "album" | "ep" | "single",
  releaseDate: string,
  trackKeys: string[],
  art: number,
) {
  const created = await call<{ id: string }>("POST", "/api/releases", owner.token, {
    artistId,
    title,
    type,
    releaseDate,
  });
  await call("PUT", `/api/releases/${created.id}/tracks`, owner.token, { trackIds: trackKeys.map((k) => t[k]) });
  await sendFile("PUT", `/api/releases/${created.id}/artwork`, owner.token, {}, image(art));
  releaseIds[title] = created.id;
}
await release(pines, pinesId, "Chalk Paths", "ep", "2026-03-14", ["pines1", "pines2", "pines3"], 3);
await release(mara, maraId, "Paper Boats", "ep", "2025-11-02", ["mara1", "mara2"], 7);
await release(harbour, harbourId, "Low Tide", "ep", "2026-06-20", ["harbour2", "harbour1"], 4);
await release(velvet, velvetId, "After Hours", "single", "2026-08-01", ["velvet1"], 2);
await release(prompter, neonId, "Infinite Content Vol. 1", "album", "2026-09-28", ["neon1", "neon2", "neon3"], 9);
await release(morrow, morrowId, "Lantern Weather", "ep", "2026-09-12", ["morrow1", "morrow2"], 5);
await release(kiln, kilnId, "Glaze", "ep", "2026-07-03", ["kiln1", "kiln2"], 6);
await release(ada, adaId, "Blue Hour", "ep", "2026-05-22", ["ada1", "ada2"], 8);

for (const [owner, artistId, art] of [
  [pines, pinesId, 11],
  [mara, maraId, 12],
  [harbour, harbourId, 13],
  [velvet, velvetId, 14],
  [prompter, neonId, 15],
  [morrow, morrowId, 16],
  [kiln, kilnId, 17],
  [ada, adaId, 18],
] as const) {
  await sendFile("PUT", `/api/artists/${artistId}/image`, owner.token, {}, image(art));
}

{
  const me = listeners[0]!;
  for (const key of ["pines1", "mara1", "harbour1", "velvet1", "pines3"])
    await call("PUT", `/api/me/likes/${t[key]}`, me.token);
  for (const id of [pinesId, maraId, harbourId]) await call("PUT", `/api/me/follows/${id}`, me.token);
  const playlists: [string, string, string[]][] = [
    ["Sunday morning", "Slow, human, and warm.", ["mara1", "pines3", "harbour2", "mara2"]],
    ["Road trip", "Windows down.", ["pines1", "pines2", "velvet1", "harbour1"]],
  ];
  for (const [name, description, keys] of playlists) {
    const created = await call<{ id: string }>("POST", "/api/playlists", me.token, { name, description });
    await call("POST", `/api/playlists/${created.id}/entries`, me.token, { trackIds: keys.map((k) => t[k]) });
  }
  // Other listeners follow a few artists too.
  for (const [i, id] of [
    [2, maraId],
    [3, harbourId],
    [4, pinesId],
    [1, neonId],
  ] as const) {
    await call("PUT", `/api/me/follows/${id}`, listeners[i]!.token);
  }
}

console.log("Simulating six months of listening…");
const random = seededRandom(20261006);
// Oldest first; the last is this month, which stays open.
const months = [5, 4, 3, 2, 1].reduce((list) => [previousPeriod(list[0]!), ...list], [currentPeriod()]);
// The first demo listeners' tastes: track key → plays per month. They've been here three months.
const tastes: Record<string, number>[] = [
  { pines1: 14, pines2: 9, mara1: 6, neon1: 12, neon2: 8, velvet1: 4 }, // listener: mixed
  { neon1: 30, neon2: 22, neon3: 18 }, // jo: AI only
  { mara1: 20, mara2: 15, pines3: 6 }, // priya: singer-songwriters
  { harbour1: 25, harbour2: 18, neon3: 10 }, // dev: electronic
  { pines1: 5, velvet1: 12, neon4: 6 }, // alex
  {}, // kim: not subscribed, so only hears previews (which never count)
];
const premium = [0, 1, 2, 3, 4];
const demoListeners: DemoListener[] = premium.map((i) => ({ id: listeners[i]!.id, taste: tastes[i]!, firstMonth: 3 }));

// Thirty more subscribers, more of them joining each month, each with a taste of their own.
demoPasswordHash ??= await hashPassword(PASSWORD);
const extras = await db
  .insert(users)
  .values(
    EXTRA_LISTENERS.map((name) => ({
      email: `${name}@trusic.local`,
      passwordHash: demoPasswordHash!,
      displayName: name[0]!.toUpperCase() + name.slice(1),
      plan: "premium",
    })),
  )
  .returning({ id: users.id });
const extraListeners: DemoListener[] = extras.map((u, n) => ({
  id: u.id,
  taste: extraTaste(n, random),
  firstMonth: Math.min(5, Math.floor((n / extras.length) ** 1.5 * 6)),
}));
demoListeners.push(...extraListeners);

const rows = simulateListening({ listeners: demoListeners, months, trackIds: t, scores, now: new Date(), random });
for (let i = 0; i < rows.length; i += 1000) await db.insert(plays).values(rows.slice(i, i + 1000));
await db.insert(revenueEntries).values(
  demoListeners.flatMap((l) =>
    months.slice(l.firstMonth).map((period) => ({
      userId: l.id,
      period,
      source: "subscription" as const,
      amount: config.premiumMonthlyNetMinor,
    })),
  ),
);
for (const i of premium) await db.update(users).set({ plan: "premium" }).where(eq(users.id, listeners[i]!.id));

// The newer listeners' likes and follows, on the days they happened, so artists can see them grow.
const artistOfKey: Record<string, string> = {
  pines: pinesId,
  mara: maraId,
  harbour: harbourId,
  velvet: velvetId,
  neon: neonId,
  morrow: morrowId,
  kiln: kilnId,
  ada: adaId,
};
const sometimeAfter = (month: number) => {
  const start = periodBounds(months[month]!)[0].getTime();
  return new Date(start + random() * (Date.now() - start));
};
for (const l of extraListeners) {
  const favourites = Object.entries(l.taste)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1 + Math.floor(random() * 3))
    .map(([key]) => key);
  await db
    .insert(likes)
    .values(favourites.map((key) => ({ userId: l.id, trackId: t[key]!, createdAt: sometimeAfter(l.firstMonth) })))
    .onConflictDoNothing();
  const artistIds = [...new Set(favourites.map((key) => artistOfKey[key.replace(/\d+$/, "")]!))].slice(0, 2);
  await db
    .insert(follows)
    .values(artistIds.map((artistId) => ({ userId: l.id, artistId, createdAt: sometimeAfter(l.firstMonth) })))
    .onConflictDoNothing();
}
console.log(
  `  ${rows.length} plays by ${demoListeners.length} subscribers (${Object.keys(TASTE_GROUPS).length} tastes)`,
);

for (const period of months.slice(0, -1)) {
  console.log(`Running payouts for ${period}…`);
  const run = await runPayouts(db, period, config.currency);
  await finalizeRun(db, period);
  console.log(
    `  ${run.totals.revenue}p in, ${run.totals.platform}p to Trusic, ${run.totals.paidToArtists}p to artists, ${run.totals.forfeitedByAi}p moved from AI to human music`,
  );
}

await app.close();
await database.close();

console.log(`
Done. Log in with any of these (password ${process.env.DEMO_PASSWORD ? "from the DEMO_PASSWORD setting" : `"${PASSWORD}"`}):
  listener@trusic.local   a Premium listener: see "Home" and "Your money"
  pines@trusic.local      The Hollow Pines: see "Studio" for stats, earnings and band splits
  pines-bass@trusic.local a band member: sees the band's stats, and only his own money
  prompter@trusic.local   Neon Prompt: an AI act with a flagged track under appeal
  admin@trusic.local      review appeals and run payouts
`);
