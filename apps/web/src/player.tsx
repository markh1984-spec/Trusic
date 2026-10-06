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
import { useLocation, useNavigate } from "react-router";
import { api, API_BASE, tokenStore } from "./api";
import { useAuth } from "./auth";
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
    const onTime = () => {
      const now = audio.currentTime;
      const delta = now - listened.current.lastTime;
      if (!audio.paused && delta > 0 && delta < 2) listened.current.ms += delta * 1000;
      listened.current.lastTime = now;
      setPositionMs(now * 1000);
    };
    const onSeeking = () => {
      listened.current.lastTime = audio.currentTime;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onDuration = () => setDurationMs(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
    const onEnded = () => {
      report();
      const q = queueRef.current;
      if (q.repeat === "one") dispatch({ type: "replay" });
      else if (hasNext(q)) dispatch({ type: "next" });
      else audio.currentTime = 0;
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
      .then(({ url }) => {
        if (cancelled) return;
        listened.current = { trackId: currentId, ms: 0, lastTime: 0 };
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
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist.name,
      album: current.release?.title ?? "Trusic",
      artwork: current.artworkUrl ? [{ src: current.artworkUrl, sizes: "512x512" }] : [],
    });
    navigator.mediaSession.setActionHandler("play", () => void audioRef.current!.play());
    navigator.mediaSession.setActionHandler("pause", () => audioRef.current!.pause());
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("previoustrack", previous);
  }, [current, next, previous]);

  const value = useMemo<PlayerState>(
    () => ({
      current,
      playing,
      positionMs,
      durationMs: durationMs || current?.durationMs || 0,
      volume,
      error,
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

/** Play a list of tracks, sending signed-out visitors to log in first. */
export function usePlayTracks() {
  const { me } = useAuth();
  const player = usePlayer();
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (tracks: TrackSummary[], startIndex: number, label?: string) => {
      if (!me) {
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      player.playQueue(tracks, startIndex, label);
    },
    [me, navigate, location, player],
  );
}
