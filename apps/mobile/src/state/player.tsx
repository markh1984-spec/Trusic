import type { TrackSummary } from "@trusic/client";
import {
  hasNext,
  initialQueue,
  queueReducer,
  upcomingFromContext,
  type QueueAction,
  type QueueState,
  type RepeatMode,
} from "@trusic/player";
import { setAudioModeAsync, useAudioPlayer, type AudioStatus } from "expo-audio";
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
import { AppState, type AppStateStatus } from "react-native";
import { api, errorMessage, mediaUrl } from "../lib/api";
import { DEFAULT_PREVIEW_MS } from "../lib/config";
import { ListenTracker } from "../lib/listen-tracker";
import { useAuth } from "./auth";

interface PlayerState {
  current: TrackSummary | null;
  playing: boolean;
  error: string | null;
  /**
   * Set when the listener isn't subscribed: they only hear the first `previewMs`
   * of each track, and playback stops there.
   */
  previewMs: number | null;
  /** The preview has played to its end. */
  previewEnded: boolean;
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
  toggleShuffle(): void;
  cycleRepeat(): void;
  /** Stop and empty the queue, e.g. before logging out. */
  stop(): Promise<void>;
}

/** Position changes several times a second, so it has its own context to keep re-renders local. */
interface Progress {
  positionMs: number;
  durationMs: number;
}

const PlayerContext = createContext<PlayerState | null>(null);
const ProgressContext = createContext<Progress>({ positionMs: 0, durationMs: 0 });

/**
 * One audio player for the whole app, so music keeps playing as you browse,
 * with the app in the background and with the screen locked.
 *
 * We count how long each track is actually heard (seeking doesn't count) and
 * report it with `api.recordPlay` when the track ends or changes, or when the
 * app goes to the background with nothing playing. While music carries on in
 * the background the listen isn't over yet, so it's reported when the track
 * ends or changes, or if playback stops while the app is in the background.
 * Reporting it early would split one listen into two plays.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const [queue, dispatch] = useReducer(
    (s: QueueState, a: QueueAction | { type: "clear" }) => (a.type === "clear" ? initialQueue : queueReducer(s, a)),
    initialQueue,
  );
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState<Progress>({ positionMs: 0, durationMs: 0 });
  const [error, setError] = useState<string | null>(null);
  const [previewMs, setPreviewMs] = useState<number | null>(null);
  const [previewEnded, setPreviewEnded] = useState(false);

  const tracker = useRef(new ListenTracker()).current;
  /** The stream that's loaded: which play of which track, and its preview limit. */
  const loaded = useRef<{ playId: number; previewMs: number | null } | null>(null);
  const finishedPlayId = useRef<number | null>(null);
  const wasPlaying = useRef(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  /** Send the listen so far to the API. Resolves once it's sent (or failed). */
  const report = useCallback(async () => {
    const listen = tracker.take();
    if (listen) await api.recordPlay(listen.trackId, listen.msPlayed).catch(() => undefined);
  }, [tracker]);

  // Keep playing with the screen locked or another app open, and on iPhones in silent mode.
  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    }).catch(() => undefined);
  }, []);

  const onStatus = useCallback(
    (status: AudioStatus) => {
      const loadedStream = loaded.current;
      const positionMs = status.currentTime * 1000;
      tracker.update(status.currentTime);
      const durationMs = status.duration > 0 ? status.duration * 1000 : (queueRef.current.current?.durationMs ?? 0);
      setProgress({ positionMs, durationMs });
      setPlaying(status.playing);
      if (status.error) setError("This track couldn't be played.");

      // Previews stop at the limit.
      if (loadedStream?.previewMs != null && positionMs >= loadedStream.previewMs) {
        if (status.playing) player.pause();
        setPreviewEnded(true);
      }

      if (status.didJustFinish && loadedStream && finishedPlayId.current !== loadedStream.playId) {
        finishedPlayId.current = loadedStream.playId;
        report();
        const q = queueRef.current;
        if (q.repeat === "one") dispatch({ type: "replay" });
        else if (hasNext(q)) dispatch({ type: "next" });
        else {
          player.pause();
          void player.seekTo(0);
          tracker.seeked(0);
        }
      } else if (appState.current !== "active" && wasPlaying.current && !status.playing) {
        // Stopped in the background (paused from the lock screen, or by the system).
        report();
      }
      wasPlaying.current = status.playing;
    },
    [player, report, tracker],
  );

  useEffect(() => {
    const sub = player.addListener("playbackStatusUpdate", onStatus);
    return () => sub.remove();
  }, [player, onStatus]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      appState.current = state;
      if (state === "background" && !player.playing) report();
    });
    return () => sub.remove();
  }, [player, report]);

  // Load and start the current track whenever the queue says so.
  const current = queue.current;
  const playId = queue.playId;
  useEffect(() => {
    // Stop the old track straight away, and forget it so its end can't move the queue on again.
    loaded.current = null;
    player.pause();
    if (!current) {
      player.clearLockScreenControls();
      return;
    }
    let cancelled = false;
    setError(null);
    setPreviewEnded(false);
    setProgress({ positionMs: 0, durationMs: current.durationMs });
    api
      .streamUrl(current.id)
      .then((stream) => {
        if (cancelled) return;
        const limit = stream.preview ? (stream.previewMs ?? DEFAULT_PREVIEW_MS) : null;
        loaded.current = { playId, previewMs: limit };
        setPreviewMs(limit);
        tracker.start(current.id, { counts: !stream.preview });
        player.replace({ uri: api.resolveUrl(stream.url) });
        player.play();
        const artworkUrl = mediaUrl(current.artworkUrl);
        player.setActiveForLockScreen(
          true,
          {
            title: current.title,
            artist: current.artist.name,
            albumTitle: current.release?.title ?? "Trusic",
            ...(artworkUrl ? { artworkUrl } : {}),
          },
          { showSeekBackward: true, showSeekForward: true },
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e, "This track couldn't be played."));
      });
    return () => {
      cancelled = true;
    };
  }, [current, playId, player, tracker]);

  // Report the last listen if the app shuts the player down.
  useEffect(() => () => void report(), [report]);

  /** Stop the music and empty the queue, reporting the last listen first. */
  const stop = useCallback(async () => {
    const reported = report();
    dispatch({ type: "clear" });
    await reported;
  }, [report]);

  // Signed out (e.g. the token expired): nothing can be reported any more, so just stop.
  const signedIn = useAuth().me !== null;
  useEffect(() => {
    if (signedIn) return;
    tracker.take();
    dispatch({ type: "clear" });
  }, [signedIn, tracker]);

  const playQueue = useCallback(
    (tracks: TrackSummary[], startIndex: number, label?: string) => {
      const target = tracks[startIndex];
      if (target && target.id === queueRef.current.current?.id && !player.playing && !previewEnded) {
        player.play();
        return;
      }
      report();
      dispatch({ type: "playContext", tracks, startIndex, label: label ?? null });
    },
    [player, previewEnded, report],
  );

  const toggle = useCallback(() => {
    if (!queueRef.current.current) return;
    if (player.playing) {
      player.pause();
      return;
    }
    if (previewEnded) {
      // Hear the preview again from the start.
      setPreviewEnded(false);
      void player.seekTo(0);
      tracker.seeked(0);
    }
    player.play();
  }, [player, previewEnded, tracker]);

  const next = useCallback(() => {
    if (!hasNext(queueRef.current)) return;
    report();
    dispatch({ type: "next" });
  }, [report]);

  const previous = useCallback(() => {
    if (player.currentTime > 3) {
      void player.seekTo(0);
      tracker.seeked(0);
      setPreviewEnded(false);
      return;
    }
    report();
    dispatch({ type: "previous" });
  }, [player, report, tracker]);

  const seek = useCallback(
    (ms: number) => {
      const limit = loaded.current?.previewMs ?? Number.POSITIVE_INFINITY;
      const target = Math.max(0, Math.min(ms, limit - 250));
      if (target < limit) setPreviewEnded(false);
      void player.seekTo(target / 1000);
      tracker.seeked(target / 1000);
    },
    [player, tracker],
  );

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

  const value = useMemo<PlayerState>(
    () => ({
      current,
      playing,
      error,
      previewMs,
      previewEnded,
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
      toggleShuffle: () => dispatch({ type: "toggleShuffle" }),
      cycleRepeat: () => dispatch({ type: "cycleRepeat" }),
      stop,
    }),
    [
      current,
      playing,
      error,
      previewMs,
      previewEnded,
      queue,
      playQueue,
      jumpToQueued,
      jumpToUpcoming,
      toggle,
      next,
      previous,
      seek,
      stop,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>
      <ProgressContext.Provider value={progress}>{children}</ProgressContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

/** Playback position and length, in milliseconds. Re-renders several times a second while playing. */
export const useProgress = () => useContext(ProgressContext);
