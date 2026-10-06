import type { CSSProperties } from "react";
import { Link } from "react-router";
import { duration } from "../format";
import { usePlayer } from "../player";
import { AiBadge } from "./AiBadge";
import { Artwork } from "./Artwork";
import { Icon } from "./Icon";
import { LikeButton } from "./LikeButton";

const REPEAT_LABELS = { off: "Repeat", all: "Repeat one", one: "Don't repeat" } as const;

export function PlayerBar({ queueOpen, onToggleQueue }: { queueOpen: boolean; onToggleQueue(): void }) {
  const p = usePlayer();
  const track = p.current;
  const progress = p.durationMs ? Math.min(100, (p.positionMs / p.durationMs) * 100) : 0;

  return (
    <footer className="player" aria-label="Player">
      <div className="player__now">
        {track ? (
          <>
            <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={54} />
            <div className="player__meta">
              <Link to={`/track/${track.id}`} className="player__title">
                {track.title}
              </Link>
              <Link to={`/artist/${track.artist.slug}`} className="player__artist">
                {track.artist.name}
              </Link>
            </div>
            <AiBadge score={track.aiScore} compact />
            <LikeButton trackId={track.id} title={track.title} />
          </>
        ) : (
          <span className="muted">Pick something to play</span>
        )}
      </div>

      <div className="player__center">
        <div className="player__controls">
          <button
            className={`icon-button toggle${p.shuffle ? " toggle--on" : ""}`}
            onClick={p.toggleShuffle}
            aria-pressed={p.shuffle}
            aria-label="Shuffle"
            title="Shuffle"
          >
            <Icon name="shuffle" size={18} />
          </button>
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
          <button
            className={`icon-button toggle${p.repeat !== "off" ? " toggle--on" : ""}`}
            onClick={p.cycleRepeat}
            aria-label={REPEAT_LABELS[p.repeat]}
            title={REPEAT_LABELS[p.repeat]}
          >
            <Icon name="repeat" size={18} />
            {p.repeat === "one" ? <span className="toggle__one">1</span> : null}
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
        {track && p.preview && !p.error ? (
          <p className="player__preview">
            30-second preview. <Link to="/money">Subscribe</Link> to hear full tracks.
          </p>
        ) : null}
      </div>

      <div className="player__volume">
        <button
          className={`icon-button toggle${queueOpen ? " toggle--on" : ""}`}
          onClick={onToggleQueue}
          aria-pressed={queueOpen}
          aria-label="Queue"
          title="Queue"
        >
          <Icon name="queue" size={18} />
        </button>
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
