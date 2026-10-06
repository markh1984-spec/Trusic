import { usePlayer } from "../player";
import { AiBadge } from "./AiBadge";
import { Artwork } from "./Artwork";
import { Icon } from "./Icon";

/** "Now playing", what you've queued, and what comes next from the album or playlist. */
export function QueuePanel({ onClose }: { onClose(): void }) {
  const p = usePlayer();

  return (
    <aside className="queue-panel" aria-label="Queue">
      <div className="queue-panel__head">
        <h2>Queue</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close queue">
          <Icon name="close" />
        </button>
      </div>

      <h3>Now playing</h3>
      {p.current ? (
        <QueueRow
          title={p.current.title}
          artist={p.current.artist.name}
          artworkUrl={p.current.artworkUrl}
          score={p.current.aiScore}
          current
        />
      ) : (
        <p className="muted small">Nothing playing.</p>
      )}

      {p.upNext.length ? (
        <>
          <h3>Next in queue</h3>
          {p.upNext.map((t, i) => (
            <QueueRow
              key={`${t.id}-${i}`}
              title={t.title}
              artist={t.artist.name}
              artworkUrl={t.artworkUrl}
              score={t.aiScore}
              onPlay={() => p.jumpToQueued(i)}
              onRemove={() => p.removeFromQueue(i)}
            />
          ))}
        </>
      ) : null}

      {p.upcoming.length ? (
        <>
          <h3>Next from {p.contextLabel ?? "this list"}</h3>
          {p.upcoming.map(({ track: t, orderIndex }) => (
            <QueueRow
              key={`${t.id}-${orderIndex}`}
              title={t.title}
              artist={t.artist.name}
              artworkUrl={t.artworkUrl}
              score={t.aiScore}
              onPlay={() => p.jumpToUpcoming(orderIndex)}
            />
          ))}
        </>
      ) : null}
    </aside>
  );
}

function QueueRow(props: {
  title: string;
  artist: string;
  artworkUrl: string | null;
  score: number;
  current?: boolean;
  onPlay?(): void;
  onRemove?(): void;
}) {
  return (
    <div className={`queue-row${props.current ? " queue-row--current" : ""}`}>
      <button
        className="queue-row__main"
        onClick={props.onPlay}
        disabled={!props.onPlay}
        aria-label={`Play ${props.title}`}
      >
        <Artwork url={props.artworkUrl} title={props.title} size={40} />
        <span className="queue-row__text">
          <span className="queue-row__title">{props.title}</span>
          <span className="muted small">{props.artist}</span>
        </span>
      </button>
      <AiBadge score={props.score} compact />
      {props.onRemove ? (
        <button className="icon-button" onClick={props.onRemove} aria-label={`Remove ${props.title} from queue`}>
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
}
