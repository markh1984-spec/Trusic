import type { TrackSummary } from "@trusic/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { api, API_BASE, tokenStore } from "./api";
import { useAuth } from "./auth";

interface PlayerState {
  queue: TrackSummary[];
  current: TrackSummary | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  error: string | null;
  playQueue(tracks: TrackSummary[], startIndex: number): void;
  toggle(): void;
  next(): void;
  previous(): void;
  seek(ms: number): void;
  setVolume(volume: number): void;
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
  const [queue, setQueue] = useState<TrackSummary[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [error, setError] = useState<string | null>(null);

  const listened = useRef({ trackId: null as string | null, ms: 0, lastTime: 0 });
  const current = index >= 0 ? (queue[index] ?? null) : null;

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
      setIndex((i) => i + 1);
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

  // Load and play whenever the current track changes.
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
  }, [currentId]);

  useEffect(() => {
    audioRef.current!.volume = volume;
  }, [volume]);

  const playQueue = useCallback(
    (tracks: TrackSummary[], startIndex: number) => {
      const target = tracks[startIndex];
      if (target && target.id === current?.id) {
        void audioRef.current!.play();
        return;
      }
      report();
      setQueue(tracks);
      setIndex(startIndex);
    },
    [current?.id, report],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current!;
    if (!current) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, [current]);

  const next = useCallback(() => {
    report();
    setIndex((i) => Math.min(i + 1, queue.length));
  }, [queue.length, report]);

  const previous = useCallback(() => {
    const audio = audioRef.current!;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    report();
    setIndex((i) => Math.max(i - 1, 0));
  }, [report]);

  const seek = useCallback((ms: number) => {
    audioRef.current!.currentTime = ms / 1000;
  }, []);

  // Lock screen, headphone buttons and media keys.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist.name,
      album: "Trusic",
    });
    navigator.mediaSession.setActionHandler("play", () => void audioRef.current!.play());
    navigator.mediaSession.setActionHandler("pause", () => audioRef.current!.pause());
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("previoustrack", previous);
  }, [current, next, previous]);

  const value = useMemo<PlayerState>(
    () => ({
      queue,
      current,
      playing,
      positionMs,
      durationMs: durationMs || current?.durationMs || 0,
      volume,
      error,
      playQueue,
      toggle,
      next,
      previous,
      seek,
      setVolume: setVolumeState,
    }),
    [queue, current, playing, positionMs, durationMs, volume, error, playQueue, toggle, next, previous, seek],
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
    (tracks: TrackSummary[], startIndex: number) => {
      if (!me) {
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      player.playQueue(tracks, startIndex);
    },
    [me, navigate, location, player],
  );
}
