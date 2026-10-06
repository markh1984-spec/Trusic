import type { TrackSummary } from "@trusic/client";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { duration } from "../format";
import { usePlayer, usePlayTracks } from "../player";
import { AiBadge } from "./AiBadge";
import { Artwork } from "./Artwork";
import { Icon } from "./Icon";
import { LikeButton } from "./LikeButton";
import { TrackMenu, type ExtraMenuItem } from "./TrackMenu";

export interface TrackListProps {
  tracks: TrackSummary[];
  /** Shown in the queue as "Playing from …". */
  label?: string;
  showArtist?: boolean;
  showArtwork?: boolean;
  /** "release" shows track numbers and hides the album column. */
  variant?: "default" | "release";
  empty?: string;
  /** Extra items for each track's menu, e.g. "Remove from this playlist". */
  menuItems?: (track: TrackSummary, index: number) => ExtraMenuItem[];
  /** Extra controls at the end of each row, e.g. reorder buttons. */
  rowActions?: (track: TrackSummary, index: number) => ReactNode;
  /** Stable keys when the same track appears twice (playlists). */
  keys?: string[];
}

export function TrackList({
  tracks,
  label,
  showArtist = true,
  showArtwork = true,
  variant = "default",
  empty,
  menuItems,
  rowActions,
  keys,
}: TrackListProps) {
  const play = usePlayTracks();
  const { current, playing, toggle } = usePlayer();

  if (tracks.length === 0) return <p className="muted">{empty ?? "No tracks yet."}</p>;
  const releaseView = variant === "release";

  return (
    <ol className={`track-list${releaseView ? " track-list--release" : ""}`}>
      {tracks.map((track, i) => {
        const isCurrent = current?.id === track.id;
        return (
          <li
            key={keys?.[i] ?? track.id}
            className={`track-row${isCurrent ? " track-row--current" : ""}`}
            onDoubleClick={() => play(tracks, i, label)}
          >
            <button
              className="track-row__play"
              onClick={() => (isCurrent ? toggle() : play(tracks, i, label))}
              aria-label={isCurrent && playing ? `Pause ${track.title}` : `Play ${track.title}`}
            >
              <span className="track-row__num">{releaseView ? (track.trackNumber ?? i + 1) : i + 1}</span>
              <Icon name={isCurrent && playing ? "pause" : "play"} size={18} />
            </button>
            <div className="track-row__main">
              {showArtwork && !releaseView ? (
                <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={40} />
              ) : null}
              <div className="track-row__text">
                <Link to={`/track/${track.id}`} className="track-row__title">
                  {track.title}
                </Link>
                {showArtist ? (
                  <Link to={`/artist/${track.artist.slug}`} className="track-row__artist">
                    {track.artist.name}
                  </Link>
                ) : null}
              </div>
            </div>
            <span className="track-row__album">
              {releaseView ? (
                track.genre
              ) : track.release ? (
                <Link to={`/release/${track.release.id}`}>{track.release.title}</Link>
              ) : (
                track.genre
              )}
            </span>
            <AiBadge score={track.aiScore} />
            <LikeButton trackId={track.id} title={track.title} />
            <span className="track-row__time">{duration(track.durationMs)}</span>
            <div className="track-row__actions">
              {rowActions?.(track, i)}
              <TrackMenu track={track} extraItems={menuItems?.(track, i)} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
