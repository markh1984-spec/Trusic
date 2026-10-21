import {
  formatLrcTime,
  looksSynced,
  parseLyrics,
  toLrc,
  type LyricsFormat,
  type TrackDetail,
  type TrackLyrics,
} from "@trusic/client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { AiBadge } from "../components/AiBadge";
import { Artwork } from "../components/Artwork";
import { ErrorNote, Loading, RequireAuth } from "../components/Guards";
import { Icon } from "../components/Icon";
import { COVER_LYRICS_NOTE, LyricLines } from "../components/Lyrics";
import { duration } from "../format";
import { useAsync } from "../hooks";
import { usePlayer } from "../player";
import { usePageTitle } from "../share";
import { useToast } from "../toast";

export function LyricsEditorPage() {
  return (
    <RequireAuth>
      <LyricsEditorLoader />
    </RequireAuth>
  );
}

function LyricsEditorLoader() {
  const { id = "" } = useParams();
  const track = useAsync(() => api.track(id), [id]);
  const lyrics = useAsync(() => api.lyrics(id), [id]);
  usePageTitle(track.data ? `Lyrics for ${track.data.title}` : null);

  const error = track.error ?? lyrics.error;
  if (error) return <ErrorNote message={error} />;
  if (!track.data || !lyrics.data) return <Loading />;
  return (
    <LyricsEditor
      key={lyrics.data.updatedAt ?? "new"}
      track={track.data}
      lyrics={lyrics.data}
      onSaved={lyrics.reload}
    />
  );
}

function LyricsEditor({ track, lyrics, onSaved }: { track: TrackDetail; lyrics: TrackLyrics; onSaved(): void }) {
  const toast = useToast();
  const [format, setFormat] = useState<LyricsFormat>(lyrics.format ?? "plain");
  const [text, setText] = useState(lyrics.source ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const check = text.trim() ? parseLyrics(format, text) : null;
  const changed = text !== (lyrics.source ?? "") || format !== (lyrics.format ?? "plain");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setLyrics(track.id, { format, text });
      toast("Lyrics saved");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the lyrics.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove the lyrics from this track?")) return;
    try {
      await api.deleteLyrics(track.id);
      toast("Lyrics removed");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the lyrics.");
    }
  };

  const header = (
    <>
      <p className="small">
        <Link to="/studio">← Studio</Link>
      </p>
      <section className="lyrics-editor__head">
        <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={88} />
        <div>
          <p className="eyebrow">Lyrics</p>
          <h1>{track.title}</h1>
          <p className="muted">
            {track.artist.name} · {duration(track.durationMs)} <AiBadge score={track.aiScore} compact />
          </p>
        </div>
      </section>
    </>
  );

  if (!lyrics.canEdit) {
    return (
      <>
        {header}
        <ErrorNote message="Only the person who uploaded this track and its band split can change its lyrics." />
      </>
    );
  }

  if (lyrics.hidden === "cover") {
    return (
      <>
        {header}
        <section className="card">
          <h2>This track is a cover</h2>
          <p>{COVER_LYRICS_NOTE}</p>
          <p className="muted small">
            If it isn't a cover, change its songwriting details on the <Link to={`/track/${track.id}`}>track page</Link>
            , then come back here.
          </p>
          {lyrics.format ? (
            <button className="button button--danger" onClick={() => void remove()}>
              Remove the lyrics saved earlier
            </button>
          ) : null}
          {error ? <ErrorNote message={error} /> : null}
        </section>
      </>
    );
  }

  /** The words to tap along to: the lyrics as they are, without any times. */
  const lines = (format === "synced" ? parseLyrics("synced", text).lines : parseLyrics("plain", text).lines)
    .map((l) => l.text)
    .filter(Boolean);

  return (
    <>
      {header}
      <div className="lyrics-editor">
        <form className="card form" onSubmit={save}>
          <div className="segmented segmented--2" role="radiogroup" aria-label="Kind of lyrics">
            {(
              [
                ["plain", "Plain text", "Just the words"],
                ["synced", "Synced", "Each line lights up as it's sung"],
              ] as const
            ).map(([value, name, hint]) => (
              <label key={value} className={format === value ? "segmented__on" : undefined}>
                <input type="radio" name="format" checked={format === value} onChange={() => setFormat(value)} />
                {name}
                <small>{hint}</small>
              </label>
            ))}
          </div>
          <p className="muted small">
            {format === "plain"
              ? "Type or paste the words. Leave an empty line between verses."
              : "Each line starts with the time it's sung, like [01:23.45] (the LRC format many lyric apps export). Easier: paste the words, then use “Sync with the music” to tap along as the song plays."}
          </p>
          {format === "plain" && looksSynced(text) ? (
            <p className="note small">
              These look like synced lyrics.{" "}
              <button type="button" className="link-button" onClick={() => setFormat("synced")}>
                Switch to synced
              </button>
            </p>
          ) : null}
          <label>
            Lyrics
            <textarea
              rows={16}
              className={format === "synced" ? "code" : undefined}
              spellCheck={format === "plain"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={format === "plain" ? "First line of the song…" : "[00:12.00]First line of the song…"}
            />
          </label>
          {check?.error ? (
            <p className="field-error" role="alert">
              {check.error}
            </p>
          ) : check ? (
            <p className="muted small">
              {check.lines.filter((l) => l.text).length} lines
              {format === "synced"
                ? `, the last at ${formatLrcTime(check.lines[check.lines.length - 1]!.timeMs ?? 0)}`
                : ""}
              .
            </p>
          ) : null}
          {error ? <ErrorNote message={error} /> : null}
          <div className="row">
            <button className="button" disabled={busy || !check || Boolean(check.error) || !changed}>
              {busy ? "Saving…" : "Save lyrics"}
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={!lines.length}
              onClick={() => setSyncing(true)}
            >
              Sync with the music
            </button>
            {lyrics.format ? (
              <button type="button" className="button button--danger" onClick={() => void remove()}>
                Remove lyrics
              </button>
            ) : null}
          </div>
          <p className="muted small">
            Only add words you or your band wrote. Lyrics for covers can't be shown, because they need a licence Trusic
            doesn't have yet.
          </p>
        </form>

        <aside className="card lyrics-editor__side">
          {syncing ? (
            <SyncTool
              track={track}
              lines={lines}
              onCancel={() => setSyncing(false)}
              onDone={(lrc) => {
                setFormat("synced");
                setText(lrc);
                setSyncing(false);
                toast("Times added. Check them, then save.");
              }}
            />
          ) : (
            <>
              <h2>Preview</h2>
              {check && !check.error ? (
                <LyricLines lines={check.lines} synced={false} active={-1} />
              ) : (
                <p className="muted small">The lyrics will appear here as listeners see them.</p>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}

/**
 * Make synced lyrics by tapping along: play the track and press Space (or "Next line") as each line starts.
 * Uses its own audio, so the main player is paused while it runs.
 */
function SyncTool({
  track,
  lines,
  onDone,
  onCancel,
}: {
  track: TrackDetail;
  lines: string[];
  onDone(lrc: string): void;
  onCancel(): void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const player = usePlayer();
  const [times, setTimes] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [previewMs, setPreviewMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (player.playing) player.toggle();
    let cancelled = false;
    api
      .streamUrl(track.id)
      .then((stream) => {
        if (cancelled) return;
        audioRef.current!.src = api.resolveUrl(stream.url);
        setPreviewMs(stream.preview ? stream.previewMs : null);
      })
      .catch(() => setError("The track couldn't be loaded."));
    return () => {
      cancelled = true;
    };
    // Only when the tool opens, not every time the main player changes.
  }, [track.id]);

  const done = times.length >= lines.length;
  const stamp = () => {
    const audio = audioRef.current!;
    if (audio.paused || done) return;
    setTimes((t) => [...t, Math.round(audio.currentTime * 1000)]);
  };
  const toggle = () => {
    const audio = audioRef.current!;
    if (audio.paused) void audio.play().catch(() => setError("The track couldn't be played."));
    else audio.pause();
  };
  const backALine = () => {
    const kept = times.slice(0, -1);
    setTimes(kept);
    // Go back to just before the line that's being redone.
    audioRef.current!.currentTime = Math.max(0, (kept[kept.length - 1] ?? 0) / 1000);
  };

  // The space bar taps the next line, even when a button has focus (it would otherwise press that button too).
  const stampRef = useRef(stamp);
  stampRef.current = stamp;
  useEffect(() => {
    const isSpace = (e: KeyboardEvent) =>
      e.code === "Space" && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement);
    const onDown = (e: KeyboardEvent) => {
      if (!isSpace(e)) return;
      e.preventDefault();
      if (!e.repeat) stampRef.current();
    };
    const onUp = (e: KeyboardEvent) => isSpace(e) && e.preventDefault();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  const next = times.length;
  const finish = () => {
    const left = lines.length - times.length;
    const message = `${left === 1 ? "The last line hasn't" : `The last ${left} lines haven't`} got a time yet, so ${left === 1 ? "it" : "they"} will be left out. Use the times so far?`;
    if (left > 0 && !window.confirm(message)) return;
    onDone(toLrc(times.map((timeMs, i) => ({ timeMs, text: lines[i]! }))));
  };

  return (
    <div className="sync-tool">
      <h2>Sync with the music</h2>
      <p className="muted small">
        Press play, then press <kbd>Space</kbd> or <strong>Next line</strong> just as each line starts. Late? Go back a
        line and try again.
      </p>
      {previewMs !== null ? (
        <p className="note note--warn small">
          You can only hear a 30-second preview, so only the first lines can be synced. The person who uploaded the
          track hears all of it.
        </p>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime * 1000)}
      />
      <ol className="sync-tool__lines" aria-live="polite">
        {next > 0 ? (
          <li className="is-past">
            <span className="sync-tool__time">{formatLrcTime(times[next - 1]!)}</span> {lines[next - 1]}
          </li>
        ) : null}
        <li className="is-active">{done ? "Every line has a time." : lines[next]}</li>
        {lines[next + 1] ? <li>{lines[next + 1]}</li> : null}
      </ol>
      <p className="muted small">
        {times.length} of {lines.length} lines synced · {duration(position)}
      </p>
      <div className="row">
        <button className="play-button" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <button className="button" onClick={stamp} disabled={!playing || done}>
          Next line
        </button>
        <button className="button button--ghost" onClick={backALine} disabled={!times.length}>
          Back a line
        </button>
      </div>
      <div className="row">
        <button className="button" onClick={finish} disabled={!times.length}>
          {done ? "Use these times" : "Use the times so far"}
        </button>
        <button className="button button--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Studio's list of tracks the user can add lyrics to, including ones they're in the band split for. */
export function LyricsTracksCard() {
  const { data } = useAsync(() => api.lyricsTracks(), []);
  if (!data?.length) return null;
  return (
    <section className="card">
      <h2>Lyrics</h2>
      <p className="muted small">
        Add the words to your tracks. Synced lyrics light up line by line as the song plays. Everyone in a track's band
        split can edit them.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Track</th>
            <th>Lyrics</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.map(({ track, format, isCover, instrumental, role }) => (
            <tr key={track.id}>
              <td>
                <Link to={`/track/${track.id}`}>{track.title}</Link>
                <span className="muted small">
                  {" "}
                  · {track.artist.name}
                  {role === "split" ? " (you're in the band split)" : ""}
                </span>
              </td>
              <td className="muted">
                {isCover
                  ? "Cover: not shown"
                  : format === "synced"
                    ? "Synced"
                    : format === "plain"
                      ? "Plain text"
                      : instrumental
                        ? "Instrumental"
                        : "None yet"}
              </td>
              <td className="num">
                <Link to={`/studio/lyrics/${track.id}`} className="button button--ghost button--small">
                  {isCover ? "View" : format ? "Edit" : "Add"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
