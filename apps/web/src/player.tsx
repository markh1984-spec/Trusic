import type { TrackSummary } from "@trusic/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, API_BASE, tokenStore } from "./api";
import {
  hasNext,
  initialQueue,
  queueReducer,
  upcomingFromContext,
  type QueueState,
  type RepeatMode,
} from "@trusic/player";

interface PlayerState {
  current: TrackSummary | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  error: string | null;
  /** Not subscribed: only the first `previewMs` of each track plays. */
  preview: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  contextLabel: string | null;
  /** Tracks the listener queued by hand. */
  upNext: TrackSummary[];
  /** The rest of the album, playlist or list that's playing. */
  upcoming: { track: TrackSummary; orderIndex: number }[];
  playQueue(tracks: TrackSummary[], startIndex: number, label?: string): void;
  playNext(track: TrackSummary): void;
  addToQueue(track: TrackSummary): void;
  removeFromQueue(index: number): void;
  jumpToQueued(index: number): void;
  jumpToUpcoming(orderIndex: number): void;
  toggle(): void;
  next(): void;
  previous(): void;
  seek(ms: number): void;
  setVolume(volume: number): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
}

const PlayerContext = createContext<PlayerState | null>(null);

/**
 * One <audio> element for the whole app, so music keeps playing as you browse.
 *
 * We count how long each track is actually heard (seeking doesn't count) and
 * report it when the track ends, changes, or the page closes. The server counts
 * 30 seconds or more as a stream.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, dispatch] = useReducer(
    (s: QueueState, a: Parameters<typeof queueReducer>[1]) => queueReducer(s, a),
    initialQueue,
  );
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [error, setError] = useState<string | null>(null);
  const [previewMs, setPreviewMs] = useState<number | null>(null);
  const previewRef = useRef<number | null>(null);
  /** Set once a preview reaches its limit, so we only move on once. */
  const previewDone = useRef(false);

  const listened = useRef({ trackId: null as string | null, ms: 0, lastTime: 0 });
  const current = queue.current;

  const report = useCallback((keepalive = false) => {
    const { trackId, ms } = listened.current;
    listened.current = { trackId: null, ms: 0, lastTime: 0 };
    if (!trackId || ms < 1000) return;
    const msPlayed = Math.round(ms);
    if (keepalive) {
      // The page is closing: a normal request would be cancelled.
      const token = tokenStore.get();
      void fetch(`${API_BASE}/plays`, {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ trackId, msPlayed }),
      }).catch(() => undefined);
    } else {
      void api.recordPlay(trackId, msPlayed).catch(() => undefined);
    }
  }, []);

  if (!audioRef.current && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
    audioRef.current.preload = "auto";
  }

  // Wire up the audio element once.
  useEffect(() => {
    const audio = audioRef.current!;
    const advance = () => {
      const q = queueRef.current;
      if (q.repeat === "one") dispatch({ type: "replay" });
      else if (hasNext(q)) dispatch({ type: "next" });
      else {
        audio.pause();
        audio.currentTime = 0;
        previewDone.current = false;
      }
    };
    const onTime = () => {
      const now = audio.currentTime;
      const delta = now - listened.current.lastTime;
      if (!audio.paused && delta > 0 && delta < 2) listened.current.ms += delta * 1000;
      listened.current.lastTime = now;
      setPositionMs(now * 1000);
      // A preview ends early, then moves on like a finished track.
      if (previewRef.current !== null && now * 1000 >= previewRef.current && !previewDone.current) {
        previewDone.current = true;
        audio.pause();
        advance();
      }
    };
    const onSeeking = () => {
      listened.current.lastTime = audio.currentTime;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onDuration = () => setDurationMs(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
    const onEnded = () => {
      report();
      advance();
    };
    const onError = () => setError("This track couldn't be played.");
    const onPageHide = () => report(true);

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("seeking", onSeeking);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("seeking", onSeeking);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [report]);

  // Start the current track from the top whenever the queue says so.
  const currentId = current?.id;
  useEffect(() => {
    const audio = audioRef.current!;
    if (!currentId) {
      audio.pause();
      return;
    }
    let cancelled = false;
    setError(null);
    setPositionMs(0);
    api
      .streamUrl(currentId)
      .then(({ url, preview, previewMs: limit }) => {
        if (cancelled) return;
        previewRef.current = preview ? limit : null;
        previewDone.current = false;
        setPreviewMs(preview ? limit : null);
        // Previews never count as plays, so there's nothing to report.
        listened.current = { trackId: preview ? null : currentId, ms: 0, lastTime: 0 };
        audio.src = api.resolveUrl(url);
        return audio.play();
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "This track couldn't be played.");
      });
    return () => {
      cancelled = true;
    };
  }, [currentId, queue.playId]);

  useEffect(() => {
    audioRef.current!.volume = volume;
  }, [volume]);

  const playQueue = useCallback(
    (tracks: TrackSummary[], startIndex: number, label?: string) => {
      const target = tracks[startIndex];
      if (target && target.id === queueRef.current.current?.id && audioRef.current!.paused) {
        void audioRef.current!.play();
        return;
      }
      report();
      dispatch({ type: "playContext", tracks, startIndex, label: label ?? null });
    },
    [report],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current!;
    if (!queueRef.current.current) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  const next = useCallback(() => {
    if (!hasNext(queueRef.current)) return;
    report();
    dispatch({ type: "next" });
  }, [report]);

  const previous = useCallback(() => {
    const audio = audioRef.current!;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    report();
    dispatch({ type: "previous" });
  }, [report]);

  const seek = useCallback((ms: number) => {
    audioRef.current!.currentTime = ms / 1000;
  }, []);

  const jumpToQueued = useCallback(
    (index: number) => {
      report();
      dispatch({ type: "jumpToQueued", index });
    },
    [report],
  );

  const jumpToUpcoming = useCallback(
    (orderIndex: number) => {
      report();
      dispatch({ type: "jumpToContext", orderIndex });
    },
    [report],
  );

  // Lock screen, headphone buttons and media keys.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    let cancelled = false;
    let blobUrl: string | null = null;
    const setMetadata = (artwork: string | null) => {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist.name,
        album: current.release?.title ?? "Trusic",
        artwork: artwork ? [{ src: artwork, sizes: "512x512" }] : [],
      });
    };
    const art = current.artworkUrl ? new URL(current.artworkUrl, window.location.href) : null;
    if (!art || art.protocol === "https:" || art.protocol === "http:") {
      setMetadata(art?.href ?? null);
    } else {
      // The desktop app serves everything from app://, which the system's media controls can't load, so hand
      // them a copy of the artwork instead.
      setMetadata(null);
      fetch(art.href)
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => {
          if (cancelled || !blob) return;
          blobUrl = URL.createObjectURL(blob);
          setMetadata(blobUrl);
        })
        .catch(() => undefined);
    }
    navigator.mediaSession.setActionHandler("play", () => void audioRef.current!.play());
    navigator.mediaSession.setActionHandler("pause", () => audioRef.current!.pause());
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("previoustrack", previous);
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [current, next, previous]);

  const value = useMemo<PlayerState>(
    () => ({
      current,
      playing,
      positionMs,
      durationMs: previewMs ?? (durationMs || current?.durationMs || 0),
      volume,
      error,
      preview: previewMs !== null,
      shuffle: queue.shuffle,
      repeat: queue.repeat,
      contextLabel: queue.contextLabel,
      upNext: queue.upNext,
      upcoming: upcomingFromContext(queue),
      playQueue,
      playNext: (track) => dispatch({ type: "playNext", track }),
      addToQueue: (track) => dispatch({ type: "addToQueue", track }),
      removeFromQueue: (index) => dispatch({ type: "removeFromQueue", index }),
      jumpToQueued,
      jumpToUpcoming,
      toggle,
      next,
      previous,
      seek,
      setVolume: setVolumeState,
      toggleShuffle: () => dispatch({ type: "toggleShuffle" }),
      cycleRepeat: () => dispatch({ type: "cycleRepeat" }),
    }),
    [
      current,
      playing,
      positionMs,
      durationMs,
      previewMs,
      volume,
      error,
      queue,
      playQueue,
      jumpToQueued,
      jumpToUpcoming,
      toggle,
      next,
      previous,
      seek,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

/** Play a list of tracks. Anyone can: visitors and non-subscribers hear 30-second previews. */
export function usePlayTracks() {
  const player = usePlayer();
  return useCallback(
    (tracks: TrackSummary[], startIndex: number, label?: string) => player.playQueue(tracks, startIndex, label),
    [player],
  );
}
