import type { ShareKind } from "@trusic/client";
import { AI_LABELS, aiLabel, type AiLabel } from "@trusic/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { artists, tracks, users } from "../db/schema";
import { loadPlaylistDetail } from "../routes/playlists";
import { loadReleaseSummaries, selectTrackSummariesWith, toArtist, toTrackSummary } from "../views";

/** What a shared link shows: in link previews, on the share image and in embeds. */
export interface ShareItem {
  kind: ShareKind;
  /** The id, or the slug for artists, as it appears in the page's address. */
  key: string;
  /** "Track", "EP", "Artist", "Playlist". */
  eyebrow: string;
  title: string;
  /** Who it's by: "The Hollow Pines", "EP by The Hollow Pines", "Playlist by Jo". */
  byline: string;
  /** The artist (or playlist owner) and their page, if they have one. */
  author: { name: string; path: string | null } | null;
  /** The AI label, always shown: a track's own, or a count across a collection's tracks. */
  label: { text: string; tone: AiLabel } | null;
  description: string;
  artworkUrl: string | null;
  /** Artist photos are shown in a circle. */
  round: boolean;
  /** Open Graph type. */
  ogType: string;
  /** Extra Open Graph properties, with paths to be made absolute. */
  links: { property: string; path: string }[];
  durationSeconds: number | null;
}

export const SHARE_KINDS = ["track", "release", "artist", "playlist"] as const satisfies readonly ShareKind[];

const TAGLINE = "Listen on Trusic, where every track shows how much AI went into it.";
const TYPE_NAMES = { album: "Album", ep: "EP", single: "Single" } as const;
const LABEL_ORDER: AiLabel[] = ["human", "ai_assisted", "ai_generated"];

const plural = (n: number, word: string) => `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "Human-made · AI score 0" */
export function trackLabel(score: number): { text: string; tone: AiLabel } {
  const label = aiLabel(score);
  return { text: `${AI_LABELS[label].name} · AI score ${score}`, tone: label };
}

/** "All 3 tracks Human-made", or "2 Human-made · 1 Partly AI" when they differ. */
export function collectionLabel(counts: Record<AiLabel, number>): { text: string; tone: AiLabel } | null {
  const total = LABEL_ORDER.reduce((acc, l) => acc + counts[l], 0);
  const present = LABEL_ORDER.filter((l) => counts[l] > 0);
  if (total === 0) return null;
  if (present.length === 1) {
    const name = AI_LABELS[present[0]!].name;
    return { text: total === 1 ? `1 track · ${name}` : `All ${total} tracks ${name}`, tone: present[0]! };
  }
  return { text: present.map((l) => `${counts[l]} ${AI_LABELS[l].name}`).join(" · "), tone: "ai_assisted" };
}

function countLabels(scores: number[]): Record<AiLabel, number> {
  const counts = { human: 0, ai_assisted: 0, ai_generated: 0 };
  for (const score of scores) counts[aiLabel(score)] += 1;
  return counts;
}

/** "3 tracks, all Human-made." or "4 tracks: 3 Human-made, 1 Partly AI." */
function trackCountSentence(counts: Record<AiLabel, number>): string {
  const total = LABEL_ORDER.reduce((acc, l) => acc + counts[l], 0);
  const present = LABEL_ORDER.filter((l) => counts[l] > 0);
  if (total === 0) return "No tracks yet.";
  if (present.length === 1) {
    const name = AI_LABELS[present[0]!].name;
    return total === 1 ? `1 track, ${name}.` : `${plural(total, "track")}, all ${name}.`;
  }
  return `${plural(total, "track")}: ${present.map((l) => `${counts[l]} ${AI_LABELS[l].name}`).join(", ")}.`;
}

/**
 * The item behind a shared link, or null if it doesn't exist or isn't public. Private playlists, anything taken
 * down after a report, removed tracks, suspended artists' tracks and deleted accounts never get a preview. (A
 * takedown of an artist or release also takes down its tracks, and deleting an account removes its tracks and
 * deletes its releases and playlists.)
 */
export async function loadShareItem(db: Db, kind: ShareKind, key: string): Promise<ShareItem | null> {
  if (kind === "artist") {
    if (!/^[a-z0-9-]{1,80}$/.test(key)) return null;
    return loadArtist(db, key);
  }
  if (!z.uuid().safeParse(key).success) return null;
  if (kind === "track") return loadTrack(db, key);
  if (kind === "release") return loadRelease(db, key);
  return loadPlaylist(db, key);
}

async function loadTrack(db: Db, id: string): Promise<ShareItem | null> {
  const [row] = await selectTrackSummariesWith(db, { status: tracks.status })
    .where(and(eq(tracks.id, id), eq(tracks.status, "live")))
    .limit(1);
  if (!row) return null;
  const track = toTrackSummary(row);
  const label = trackLabel(track.aiScore);
  return {
    kind: "track",
    key: id,
    eyebrow: "Track",
    title: track.title,
    byline: track.artist.name,
    author: { name: track.artist.name, path: `/artist/${track.artist.slug}` },
    label,
    description: `${track.artist.name}${track.release ? ` · ${track.release.title}` : ""} · ${AI_LABELS[track.aiLabel].name}, AI score ${track.aiScore} out of 100. ${TAGLINE}`,
    artworkUrl: track.artworkUrl,
    round: false,
    ogType: "music.song",
    links: track.release ? [{ property: "music:album", path: `/release/${track.release.id}` }] : [],
    durationSeconds: Math.round(track.durationMs / 1000),
  };
}

async function loadRelease(db: Db, id: string): Promise<ShareItem | null> {
  const [release] = await loadReleaseSummaries(db, { ids: [id] });
  if (!release) return null;
  const type = TYPE_NAMES[release.type];
  const year = release.releaseDate?.slice(0, 4);
  return {
    kind: "release",
    key: id,
    eyebrow: type,
    title: release.title,
    byline: `${type} by ${release.artist.name}`,
    author: { name: release.artist.name, path: `/artist/${release.artist.slug}` },
    label: collectionLabel(release.aiLabels),
    description: `${type} by ${release.artist.name}${year ? `, ${year}` : ""}. ${trackCountSentence(release.aiLabels)} ${TAGLINE}`,
    artworkUrl: release.artworkUrl,
    round: false,
    ogType: "music.album",
    links: [],
    durationSeconds: null,
  };
}

async function loadArtist(db: Db, slug: string): Promise<ShareItem | null> {
  const [row] = await db
    .select({ artist: artists })
    .from(artists)
    .innerJoin(users, eq(users.id, artists.ownerUserId))
    // Not taken down after a report, and its owner hasn't deleted their account.
    .where(and(eq(artists.slug, slug), isNull(artists.takenDownAt), isNull(users.deletedAt)))
    .limit(1);
  if (!row) return null;
  const artist = toArtist(row.artist);
  const scores = await db
    .select({ aiScore: tracks.aiScore })
    .from(tracks)
    .where(and(eq(tracks.artistId, artist.id), eq(tracks.status, "live")));
  const counts = countLabels(scores.map((s) => s.aiScore));
  return {
    kind: "artist",
    key: slug,
    eyebrow: "Artist",
    title: artist.name,
    byline: "Artist on Trusic",
    author: null,
    label: collectionLabel(counts),
    description: `${trackCountSentence(counts)}${artist.bio ? ` ${clip(artist.bio, 160)}` : ""} ${TAGLINE}`,
    artworkUrl: artist.imageUrl,
    round: true,
    ogType: "profile",
    links: [],
    durationSeconds: null,
  };
}

async function loadPlaylist(db: Db, id: string): Promise<ShareItem | null> {
  // Without a viewer, private playlists come back as null.
  const playlist = await loadPlaylistDetail(db, id, null);
  if (!playlist?.isPublic) return null;
  const counts = countLabels(playlist.entries.map((e) => e.track.aiScore));
  return {
    kind: "playlist",
    key: id,
    eyebrow: "Playlist",
    title: playlist.name,
    byline: `Playlist by ${playlist.owner.displayName}`,
    author: { name: playlist.owner.displayName, path: null },
    label: collectionLabel(counts),
    description: `Playlist by ${playlist.owner.displayName}. ${trackCountSentence(counts)}${playlist.description ? ` ${clip(playlist.description, 160)}` : ""} ${TAGLINE}`,
    artworkUrl: playlist.artworkUrls[0] ?? null,
    round: false,
    ogType: "music.playlist",
    links: [],
    durationSeconds: null,
  };
}
