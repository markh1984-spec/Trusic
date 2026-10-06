import type { Artist, PlaylistSummary, ReleaseSummary } from "@trusic/client";
import { AI_LABELS } from "@trusic/core";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Artwork, PlaylistCover } from "./Artwork";

export const TYPE_NAMES = { album: "Album", ep: "EP", single: "Single" } as const;

export const releaseYear = (r: { releaseDate: string | null }) => r.releaseDate?.slice(0, 4) ?? null;

/** "4 Human-made" / "2 Human-made · 1 AI Slop" */
export function releaseAiSummary(r: ReleaseSummary): string {
  const parts = (["human", "ai_assisted", "ai_generated"] as const)
    .filter((label) => r.aiLabels[label] > 0)
    .map((label) => `${r.aiLabels[label]} ${AI_LABELS[label].name}`);
  return parts.join(" · ") || "No tracks yet";
}

/** One label for a whole release, so AI albums are as obvious as AI tracks. */
export function releaseLabel(r: ReleaseSummary): { className: string; name: string } | null {
  const { human, ai_assisted, ai_generated } = r.aiLabels;
  if (r.trackCount === 0) return null;
  if (human === r.trackCount) return { className: "human", name: AI_LABELS.human.name };
  if (ai_generated === r.trackCount) return { className: "ai_generated", name: AI_LABELS.ai_generated.name };
  if (ai_assisted === r.trackCount) return { className: "ai_assisted", name: AI_LABELS.ai_assisted.name };
  return { className: "ai_assisted", name: "Some AI" };
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="card-grid">{children}</div>;
}

export function ReleaseCard({ release, showArtist = false }: { release: ReleaseSummary; showArtist?: boolean }) {
  const label = releaseLabel(release);
  return (
    <Link to={`/release/${release.id}`} className="tile">
      <span className="tile__art">
        <Artwork url={release.artworkUrl} title={release.title} size="fill" />
        {label ? (
          <span className={`tile__label ai-badge ai-badge--${label.className}`} title={releaseAiSummary(release)}>
            <span className="ai-badge__dot" aria-hidden />
            {label.name}
          </span>
        ) : null}
      </span>
      <span className="tile__title">{release.title}</span>
      <span className="tile__sub">
        {[releaseYear(release), TYPE_NAMES[release.type], showArtist ? release.artist.name : null]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </Link>
  );
}

export function PlaylistCard({ playlist }: { playlist: PlaylistSummary }) {
  return (
    <Link to={`/playlist/${playlist.id}`} className="tile">
      <PlaylistCover urls={playlist.artworkUrls} title={playlist.name} />
      <span className="tile__title">{playlist.name}</span>
      <span className="tile__sub">
        {playlist.trackCount} tracks · {playlist.owner.displayName}
      </span>
    </Link>
  );
}

export function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <Link to={`/artist/${artist.slug}`} className="tile tile--artist">
      <Artwork url={artist.imageUrl} title={artist.name} size="fill" round />
      <span className="tile__title">{artist.name}</span>
      <span className="tile__sub">Artist</span>
    </Link>
  );
}
