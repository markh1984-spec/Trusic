import { ApiError, sharePath, TrusicClient, type EmbedKind, type TrackSummary } from "@trusic/client";
import { AI_LABELS, aiLabel, type AiLabel } from "@trusic/core";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AiBadge } from "../components/AiBadge";
import { Artwork } from "../components/Artwork";
import { duration } from "../format";

/**
 * The player bands put on their own websites. Nobody signs in inside someone else's website, so this client never
 * sends a login: everyone hears 30-second previews, which never count as plays. Links open Trusic in a new tab to
 * listen in full.
 */
const client = new TrusicClient({ baseUrl: import.meta.env.VITE_API_URL ?? "/api" });

const NOT_FOUND: Record<EmbedKind, string> = {
  track: "This track isn't available on Trusic.",
  release: "This release isn't available on Trusic.",
  artist: "This artist isn't on Trusic.",
};
const TYPE_NAMES = { album: "Album", ep: "EP", single: "Single" } as const;
const LABEL_ORDER: AiLabel[] = ["human", "ai_assisted", "ai_generated"];

interface EmbedData {
  eyebrow: string;
  title: string;
  byline: { name: string; path: string } | null;
  artworkUrl: string | null;
  round: boolean;
  tracks: TrackSummary[];
}

export function readEmbedLocation(pathname: string): { kind: EmbedKind; key: string } | null {
  const match = /^\/embed\/(track|release|artist)\/([^/]+)\/?$/.exec(pathname);
  return match ? { kind: match[1] as EmbedKind, key: decodeURIComponent(match[2]!) } : null;
}

async function load(kind: EmbedKind, key: string): Promise<EmbedData> {
  if (kind === "track") {
    const track = await client.track(key);
    return {
      eyebrow: "Track",
      title: track.title,
      byline: { name: track.artist.name, path: `/artist/${track.artist.slug}` },
      artworkUrl: track.artworkUrl,
      round: false,
      tracks: [track],
    };
  }
  if (kind === "release") {
    const release = await client.release(key);
    return {
      eyebrow: TYPE_NAMES[release.type],
      title: release.title,
      byline: { name: release.artist.name, path: `/artist/${release.artist.slug}` },
      artworkUrl: release.artworkUrl,
      round: false,
      tracks: release.tracks,
    };
  }
  const page = await client.artist(key);
  return {
    eyebrow: "Artist",
    title: page.artist.name,
    byline: null,
    artworkUrl: page.artist.imageUrl,
    round: true,
    tracks: page.tracks,
  };
}

/** "All 3 tracks Human-made", or "2 Human-made · 1 Partly AI". */
function labelSummary(tracks: TrackSummary[]): { text: string; tone: AiLabel } | null {
  const counts = { human: 0, ai_assisted: 0, ai_generated: 0 };
  for (const t of tracks) counts[aiLabel(t.aiScore)] += 1;
  const present = LABEL_ORDER.filter((l) => counts[l] > 0);
  if (present.length === 0) return null;
  if (present.length === 1) {
    const name = AI_LABELS[present[0]!].name;
    return {
      text: tracks.length === 1 ? `1 track · ${name}` : `All ${tracks.length} tracks ${name}`,
      tone: present[0]!,
    };
  }
  return { text: present.map((l) => `${counts[l]} ${AI_LABELS[l].name}`).join(" · "), tone: "ai_assisted" };
}

/** One audio element playing previews, moving on to the next track when one ends. */
function usePreviewPlayer(tracks: TrackSummary[]) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current && typeof Audio !== "undefined") audioRef.current = new Audio();
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [limit, setLimit] = useState(30_000);
  const [error, setError] = useState<string | null>(null);
  const state = useRef({ tracks, index, limit, ended: false });
  state.current.tracks = tracks;
  state.current.index = index;
  state.current.limit = limit;

  const start = useCallback(async (i: number) => {
    const track = state.current.tracks[i];
    const audio = audioRef.current!;
    if (!track) return;
    setIndex(i);
    setError(null);
    setPosition(0);
    try {
      // No login is ever sent from here, so the server always hands back a preview.
      const stream = await client.streamUrl(track.id);
      const previewMs = stream.previewMs ?? Math.min(30_000, track.durationMs);
      state.current.limit = previewMs;
      state.current.ended = false;
      setLimit(previewMs);
      setLoaded(track.id);
      audio.src = client.resolveUrl(stream.url);
      await audio.play();
    } catch {
      setError("This preview couldn't be played.");
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current!;
    const finish = () => {
      if (state.current.ended) return;
      state.current.ended = true;
      audio.pause();
      const next = state.current.index + 1;
      if (next < state.current.tracks.length) void start(next);
      else {
        audio.currentTime = 0;
        setPosition(0);
      }
    };
    const onTime = () => {
      const ms = audio.currentTime * 1000;
      setPosition(Math.min(ms, state.current.limit));
      if (ms >= state.current.limit) finish();
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => setError("This preview couldn't be played.");
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", onError);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", finish);
      audio.removeEventListener("error", onError);
    };
  }, [start]);

  const toggle = (i: number) => {
    const audio = audioRef.current!;
    if (loaded && loaded === tracks[i]?.id) {
      state.current.ended = false;
      if (audio.paused) void audio.play();
      else audio.pause();
    } else void start(i);
  };
  const seek = (ms: number) => {
    audioRef.current!.currentTime = ms / 1000;
    setPosition(ms);
  };
  return {
    index,
    current: tracks[index] ?? null,
    isLoaded: (id: string) => loaded === id,
    playing,
    position,
    limit,
    error,
    toggle,
    seek,
  };
}

export function EmbedPlayer() {
  const [where] = useState(() => readEmbedLocation(window.location.pathname));
  const [data, setData] = useState<EmbedData | null>(null);
  const [error, setError] = useState<string | null>(where ? null : "This player link isn't right.");
  const player = usePreviewPlayer(data?.tracks ?? []);

  useEffect(() => {
    if (!where) return;
    load(where.kind, where.key).then(setData, (e: unknown) =>
      setError(
        e instanceof ApiError && e.status === 404
          ? NOT_FOUND[where.kind]
          : "Couldn't reach Trusic. Try again in a moment.",
      ),
    );
  }, [where]);

  if (error || !where) {
    return (
      <div className="embed embed--message">
        <p>{error}</p>
        <a href="/" target="_blank" rel="noopener">
          Go to Trusic
        </a>
      </div>
    );
  }
  if (!data) return <div className="embed embed--message" aria-busy="true" />;

  const { kind, key } = where;
  const page = sharePath(kind, key);
  const current = player.current;
  const summary = kind === "track" ? null : labelSummary(data.tracks);
  const isList = kind !== "track";
  const progress = player.limit ? Math.min(100, (player.position / player.limit) * 100) : 0;
  const playingThis = (t: TrackSummary) => player.isLoaded(t.id) && player.playing;

  return (
    <div className={`embed embed--${kind}`}>
      <header className="embed__head">
        <a href={page} target="_blank" rel="noopener" className="embed__art" tabIndex={-1} aria-hidden>
          <Artwork
            url={data.artworkUrl}
            title={data.title}
            label={kind === "track" ? data.tracks[0]?.aiLabel : summary?.tone}
            size={isList ? 112 : 120}
            round={data.round}
          />
        </a>
        <div className="embed__info">
          <p className="embed__eyebrow">{data.eyebrow}</p>
          <h1 className="embed__title">
            <a href={page} target="_blank" rel="noopener">
              {data.title}
            </a>
          </h1>
          {data.byline ? (
            <p className="embed__byline">
              <a href={data.byline.path} target="_blank" rel="noopener">
                {data.byline.name}
              </a>
            </p>
          ) : null}
          <div className="embed__label">
            {kind === "track" && current ? <AiBadge score={current.aiScore} /> : null}
            {summary ? (
              <span className={`ai-badge ai-badge--${summary.tone}`}>
                <span className="ai-badge__dot" aria-hidden />
                {summary.text}
              </span>
            ) : null}
          </div>
          {current ? (
            <div className="embed__player">
              <button
                className="embed__play"
                onClick={() => player.toggle(player.index)}
                aria-label={player.playing ? `Pause ${current.title}` : `Play a preview of ${current.title}`}
              >
                <PlayIcon playing={player.playing} />
              </button>
              <div className="embed__progress">
                {isList ? <span className="embed__now">{current.title}</span> : null}
                <input
                  type="range"
                  className="embed__slider"
                  min={0}
                  max={Math.max(1, Math.round(player.limit))}
                  value={Math.round(player.position)}
                  onChange={(e) => player.seek(Number(e.target.value))}
                  disabled={!player.isLoaded(current.id)}
                  aria-label="Seek"
                  style={{ "--fill": `${progress}%` } as CSSProperties}
                />
              </div>
              <span className="embed__time">
                {duration(player.position)} / {duration(player.limit)}
              </span>
            </div>
          ) : (
            <p className="embed__muted">No tracks yet.</p>
          )}
        </div>
        <a className="embed__brand" href="/" target="_blank" rel="noopener" aria-label="Trusic" title="Trusic">
          T
        </a>
      </header>

      {isList && data.tracks.length ? (
        <ol className="embed__list">
          {data.tracks.map((t, i) => (
            <li key={t.id} className={i === player.index && player.isLoaded(t.id) ? "is-current" : undefined}>
              <button
                className="embed__row"
                onClick={() => player.toggle(i)}
                aria-label={playingThis(t) ? `Pause ${t.title}` : `Play a preview of ${t.title}`}
              >
                <span className="embed__num">{playingThis(t) ? <PlayIcon playing size={12} /> : i + 1}</span>
                <span className="embed__track">
                  <span className="embed__track-title">{t.title}</span>
                  {kind === "artist" && t.release ? <span className="embed__muted">{t.release.title}</span> : null}
                </span>
                <AiBadge score={t.aiScore} />
                <span className="embed__muted embed__duration">{duration(t.durationMs)}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      <footer className="embed__foot">
        {player.error ? <span className="embed__error">{player.error}</span> : <span>30-second previews</span>}
        <a href={current && isList ? `/track/${current.id}` : page} target="_blank" rel="noopener">
          Listen in full on Trusic
        </a>
      </footer>
    </div>
  );
}

function PlayIcon({ playing, size = 18 }: { playing: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path
        d={
          playing
            ? "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"
            : "M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"
        }
      />
    </svg>
  );
}
