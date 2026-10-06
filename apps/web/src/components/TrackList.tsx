import type { TrackSummary } from "@trusic/client";
import { Link } from "react-router";
import { duration } from "../format";
import { usePlayer, usePlayTracks } from "../player";
import { AiBadge } from "./AiBadge";
import { Icon } from "./Icon";

export function TrackList({
  tracks,
  showArtist = true,
  empty,
}: {
  tracks: TrackSummary[];
  showArtist?: boolean;
  empty?: string;
}) {
  const play = usePlayTracks();
  const { current, playing, toggle } = usePlayer();

  if (tracks.length === 0) return <p className="muted">{empty ?? "No tracks yet."}</p>;

  return (
    <ol className="track-list">
      {tracks.map((track, i) => {
        const isCurrent = current?.id === track.id;
        return (
          <li key={track.id} className={`track-row${isCurrent ? " track-row--current" : ""}`}>
            <button
              className="track-row__play"
              onClick={() => (isCurrent ? toggle() : play(tracks, i))}
              aria-label={isCurrent && playing ? `Pause ${track.title}` : `Play ${track.title}`}
            >
              <span className="track-row__num">{i + 1}</span>
              <Icon name={isCurrent && playing ? "pause" : "play"} size={18} />
            </button>
            <div className="track-row__main">
              <Link to={`/track/${track.id}`} className="track-row__title">
                {track.title}
              </Link>
              {showArtist ? (
                <Link to={`/artist/${track.artist.slug}`} className="track-row__artist">
                  {track.artist.name}
                </Link>
              ) : null}
            </div>
            <span className="track-row__genre">{track.genre}</span>
            <AiBadge score={track.aiScore} />
            <span className="track-row__time">{duration(track.durationMs)}</span>
          </li>
        );
      })}
    </ol>
  );
}
