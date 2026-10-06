import type { CSSProperties } from "react";
import { Link } from "react-router";
import { duration } from "../format";
import { usePlayer } from "../player";
import { AiBadge } from "./AiBadge";
import { Icon } from "./Icon";

export function PlayerBar() {
  const p = usePlayer();
  const track = p.current;
  const progress = p.durationMs ? Math.min(100, (p.positionMs / p.durationMs) * 100) : 0;

  return (
    <footer className="player" aria-label="Player">
      <div className="player__now">
        {track ? (
          <>
            <div className="player__art" aria-hidden>
              {track.title.slice(0, 1)}
            </div>
            <div className="player__meta">
              <Link to={`/track/${track.id}`} className="player__title">
                {track.title}
              </Link>
              <Link to={`/artist/${track.artist.slug}`} className="player__artist">
                {track.artist.name}
              </Link>
            </div>
            <AiBadge score={track.aiScore} compact />
          </>
        ) : (
          <span className="muted">Pick something to play</span>
        )}
      </div>

      <div className="player__center">
        <div className="player__controls">
          <button className="icon-button" onClick={p.previous} disabled={!track} aria-label="Previous">
            <Icon name="previous" />
          </button>
          <button
            className="play-button"
            onClick={p.toggle}
            disabled={!track}
            aria-label={p.playing ? "Pause" : "Play"}
          >
            <Icon name={p.playing ? "pause" : "play"} size={22} />
          </button>
          <button className="icon-button" onClick={p.next} disabled={!track} aria-label="Next">
            <Icon name="next" />
          </button>
        </div>
        <div className="player__progress">
          <span className="player__time">{duration(p.positionMs)}</span>
          <input
            type="range"
            className="slider"
            min={0}
            max={Math.max(1, Math.round(p.durationMs))}
            value={Math.round(p.positionMs)}
            onChange={(e) => p.seek(Number(e.target.value))}
            disabled={!track}
            aria-label="Seek"
            style={{ "--fill": `${progress}%` } as CSSProperties}
          />
          <span className="player__time">{duration(p.durationMs)}</span>
        </div>
        {p.error ? <p className="player__error">{p.error}</p> : null}
      </div>

      <div className="player__volume">
        <Icon name="volume" />
        <input
          type="range"
          className="slider"
          min={0}
          max={100}
          value={Math.round(p.volume * 100)}
          onChange={(e) => p.setVolume(Number(e.target.value) / 100)}
          aria-label="Volume"
          style={{ "--fill": `${p.volume * 100}%` } as CSSProperties}
        />
      </div>
    </footer>
  );
}
