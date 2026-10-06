/**
 * Fill a local Trusic with demo data: human bands, an AI-assisted act, a
 * prompt-generated "artist", a flagged upload awaiting review, listeners, and a
 * finished payout month.
 *
 *   pnpm seed           seed an empty database
 *   pnpm seed --reset   wipe local data first (embedded database only)
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import type { AiDeclaration, StageDeclaration } from "@trusic/core";
import { eq } from "drizzle-orm";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { plays, revenueEntries, users } from "./db/schema";
import { MetadataDetector } from "./detection";
import { currentPeriod, periodBounds, previousPeriod, runPayouts } from "./payout-service";
import { LocalAudioStorage } from "./storage";
import { synthWav } from "./synth";

const PASSWORD = "trusic-demo";
const config = loadConfig();

if (process.argv.includes("--reset")) {
  if (config.databaseUrl) throw new Error("--reset only works with the embedded database. Reset Postgres yourself.");
  await rm(config.dataDir, { recursive: true, force: true });
  console.log(`Removed ${config.dataDir}`);
}

const database = await openDatabase({ url: config.databaseUrl, dataDir: path.join(config.dataDir, "pglite") });
const { db } = database;
const app = await buildApp({
  db,
  storage: new LocalAudioStorage(path.join(config.dataDir, "audio")),
  detector: new MetadataDetector(),
  config,
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
  return res.json() as T;
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
  const boundary = `----trusicseed${seed}`;
  const fields = { artistId, title, genre, declaration: JSON.stringify(declaration) };
  const payload = Buffer.concat([
    ...Object.entries(fields).map(([k, v]) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${title}.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    audio,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: "POST",
    url: "/api/tracks",
    headers: { authorization: `Bearer ${owner.token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  if (res.statusCode !== 201) throw new Error(`upload ${title} failed: ${res.body}`);
  const track = res.json() as { id: string; aiScore: number };
  console.log(`  ${title.padEnd(26)} AI ${String(track.aiScore).padStart(3)}`);
  return track.id;
}

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
    { composition: "assisted", instrumentation: "assisted", lyrics: "not_applicable", vocals: "not_applicable" },
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

console.log("Simulating listening…");
// Each listener's taste: track key → plays per month.
const tastes: Record<string, number>[] = [
  { pines1: 14, pines2: 9, mara1: 6, neon1: 12, neon2: 8, velvet1: 4 }, // listener: mixed
  { neon1: 30, neon2: 22, neon3: 18 }, // jo: AI only
  { mara1: 20, mara2: 15, pines3: 6 }, // priya: singer-songwriters
  { harbour1: 25, harbour2: 18, neon3: 10 }, // dev: electronic
  { pines1: 5, velvet1: 12, neon4: 6 }, // alex
  { pines2: 3, mara1: 3, harbour2: 3 }, // kim: free listener
];
const premium = [0, 1, 2, 3, 4];

const previous = previousPeriod(currentPeriod());
for (const period of [previous, currentPeriod()]) {
  const [start, end] = periodBounds(period);
  const span = Math.min(end.getTime(), Date.now()) - start.getTime();
  const rows: (typeof plays.$inferInsert)[] = [];
  listeners.forEach((listener, i) => {
    for (const [key, count] of Object.entries(tastes[i]!)) {
      for (let n = 0; n < count; n++) {
        const skipped = (n * 7 + i) % 9 === 0;
        rows.push({
          userId: listener.id,
          trackId: t[key]!,
          msPlayed: skipped ? 8_000 : 45_000,
          playedAt: new Date(start.getTime() + (((n * 2_654_435_761 + i * 97) % 1000) / 1000) * span),
        });
      }
    }
  });
  await db.insert(plays).values(rows);
  await db.insert(revenueEntries).values(
    premium.map((i) => ({
      userId: listeners[i]!.id,
      period,
      source: "subscription" as const,
      amount: config.premiumMonthlyNetMinor,
    })),
  );
}
for (const i of premium) await db.update(users).set({ plan: "premium" }).where(eq(users.id, listeners[i]!.id));

console.log(`Running payouts for ${previous}…`);
const run = await runPayouts(db, previous, config.currency);
console.log(
  `  ${run.totals.revenue}p in, ${run.totals.platform}p to Trusic, ${run.totals.paidToArtists}p to artists, ${run.totals.forfeitedByAi}p moved from AI to human music`,
);

await app.close();
await database.close();

console.log(`
Done. Log in with any of these (password "${PASSWORD}"):
  listener@trusic.local   a Premium listener: see "Your money"
  pines@trusic.local      The Hollow Pines: see "Studio" for earnings and band splits
  prompter@trusic.local   Neon Prompt: an AI act with a flagged track under appeal
  admin@trusic.local      review appeals and run payouts
`);
