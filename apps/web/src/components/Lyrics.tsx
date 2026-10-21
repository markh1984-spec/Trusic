import { activeLyricIndex, type LyricLine, type TrackSummary } from "@trusic/client";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useAsync } from "../hooks";
import { usePlayer } from "../player";
import { Icon } from "./Icon";
import "../share.css";

export const COVER_LYRICS_NOTE =
  "Lyrics aren't shown for covers. The words belong to the original songwriters, and showing them needs a licence Trusic doesn't have yet.";

/**
 * Lyrics, one line per row. For synced lyrics of the track that's playing, the line being sung is highlighted;
 * with `follow` it's kept in view, and with `onSeek` clicking a line jumps the music to it.
 */
export function LyricLines({
  lines,
  synced,
  active,
  follow = false,
  onSeek,
  seekableUntilMs = Infinity,
}: {
  lines: LyricLine[];
  /** True while synced lyrics follow the music. */
  synced: boolean;
  active: number;
  follow?: boolean;
  onSeek?(ms: number): void;
  /** Previews stop after 30 seconds, so later lines can't be jumped to. */
  seekableUntilMs?: number;
}) {
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (follow) activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, follow]);

  return (
    <ol className={`lyrics${synced ? " lyrics--following" : ""}`}>
      {lines.map((line, i) => {
        const state = i === active ? " is-active" : i < active ? " is-past" : "";
        const seekable = onSeek && line.text && line.timeMs !== null && line.timeMs < seekableUntilMs;
        return (
          <li
            key={i}
            ref={i === active ? activeRef : undefined}
            className={`lyrics__line${line.text ? "" : " lyrics__gap"}${state}`}
            aria-current={i === active ? "true" : undefined}
          >
            {seekable ? <button onClick={() => onSeek(line.timeMs!)}>{line.text}</button> : line.text}
          </li>
        );
      })}
    </ol>
  );
}

/** The Lyrics card on a track's page. */
export function TrackLyrics({ track }: { track: TrackSummary }) {
  const { data } = useAsync(() => api.lyrics(track.id), [track.id]);
  const player = usePlayer();
  if (!data || data.trackId !== track.id) return null;

  const edit =
    data.canEdit && data.hidden !== "cover" ? (
      <Link to={`/studio/lyrics/${track.id}`} className="button button--ghost button--small">
        {data.format ? "Edit lyrics" : "Add lyrics"}
      </Link>
    ) : null;

  if (!data.format) {
    if (data.hidden === "cover") {
      return (
        <section className="card lyrics-card">
          <h2>Lyrics</h2>
          <p className="muted small">{COVER_LYRICS_NOTE}</p>
        </section>
      );
    }
    if (!data.canEdit) return null;
    return (
      <section className="card lyrics-card">
        <div className="section-head">
          <h2>Lyrics</h2>
          {edit}
        </div>
        <p className="muted">No lyrics yet. Add them as plain text, or synced so each line lights up as it's sung.</p>
      </section>
    );
  }

  const isCurrent = player.current?.id === track.id;
  const following = data.format === "synced" && isCurrent;
  const active = following ? activeLyricIndex(data.lines, player.positionMs) : -1;
  return (
    <section className="card lyrics-card">
      <div className="section-head">
        <h2>Lyrics</h2>
        {edit}
      </div>
      {data.hidden === "cover" ? (
        <p className="note note--warn small">Only you and your band can see these. {COVER_LYRICS_NOTE}</p>
      ) : null}
      {data.format === "synced" && !isCurrent ? (
        <p className="muted small">These lyrics follow the music. Press play and each line lights up as it's sung.</p>
      ) : null}
      <LyricLines
        lines={data.lines}
        synced={following}
        active={active}
        onSeek={following ? player.seek : undefined}
        seekableUntilMs={player.durationMs}
      />
    </section>
  );
}

/** The player's Lyrics panel, following whatever is playing. */
export function LyricsPanel({ onClose }: { onClose(): void }) {
  const p = usePlayer();
  const track = p.current;
  const { data, error } = useAsync(() => (track ? api.lyrics(track.id) : Promise.resolve(null)), [track?.id]);
  const lyrics = data && data.trackId === track?.id ? data : null;
  const synced = lyrics?.format === "synced";
  const active = synced ? activeLyricIndex(lyrics.lines, p.positionMs) : -1;

  return (
    <aside className="queue-panel lyrics-panel" aria-label="Lyrics">
      <div className="queue-panel__head">
        <h2>Lyrics</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close lyrics">
          <Icon name="close" />
        </button>
      </div>
      {track ? (
        <p className="muted small">
          <Link to={`/track/${track.id}`}>{track.title}</Link> · {track.artist.name}
        </p>
      ) : (
        <p className="muted small">Nothing playing.</p>
      )}
      {error ? (
        <p className="muted small">
          Couldn't load the lyrics. They need an internet connection, even for downloaded tracks.
        </p>
      ) : null}
      {track && lyrics && !lyrics.format ? (
        <p className="muted">{lyrics.hidden === "cover" ? COVER_LYRICS_NOTE : "No lyrics for this track yet."}</p>
      ) : null}
      {lyrics?.format ? (
        <>
          {lyrics.format === "plain" ? <p className="muted small">These lyrics aren't synced to the music.</p> : null}
          <LyricLines
            lines={lyrics.lines}
            synced={synced}
            active={active}
            follow={synced}
            onSeek={synced ? p.seek : undefined}
            seekableUntilMs={p.durationMs}
          />
        </>
      ) : null}
    </aside>
  );
}
