/**
 * What plays next. Pure state and transitions, kept apart from the <audio>
 * element so the rules (shuffle, repeat, "play next") are easy to test.
 *
 * - The context is the list playback started from (an album, a playlist, search
 *   results). `order` is the order its tracks play in, shuffled or not.
 * - `upNext` holds tracks the listener queued by hand. They play before the
 *   context carries on, like Spotify's queue.
 */
import type { TrackSummary } from "@trusic/client";

export type RepeatMode = "off" | "all" | "one";

export interface QueueState {
  context: TrackSummary[];
  contextLabel: string | null;
  order: number[];
  /** Index into `order` of the context track playing (or last played). */
  position: number;
  upNext: TrackSummary[];
  current: TrackSummary | null;
  currentFrom: "context" | "queue" | null;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Goes up every time a track should start from the beginning. */
  playId: number;
}

export const initialQueue: QueueState = {
  context: [],
  contextLabel: null,
  order: [],
  position: -1,
  upNext: [],
  current: null,
  currentFrom: null,
  shuffle: false,
  repeat: "off",
  playId: 0,
};

export type QueueAction =
  | { type: "playContext"; tracks: TrackSummary[]; startIndex: number; label: string | null }
  | { type: "next" }
  | { type: "previous" }
  | { type: "replay" }
  | { type: "playNext"; track: TrackSummary }
  | { type: "addToQueue"; track: TrackSummary }
  | { type: "removeFromQueue"; index: number }
  | { type: "jumpToQueued"; index: number }
  | { type: "jumpToContext"; orderIndex: number }
  | { type: "toggleShuffle" }
  | { type: "cycleRepeat" };

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Play order with `first` at the front and the rest shuffled. */
const shuffledOrder = (length: number, first: number, random: () => number) => [
  first,
  ...shuffled(
    range(length).filter((i) => i !== first),
    random,
  ),
];

export function hasNext(state: QueueState): boolean {
  return (
    state.upNext.length > 0 ||
    state.position + 1 < state.order.length ||
    (state.repeat === "all" && state.order.length > 0)
  );
}

/** Tracks still to come from the context, in play order. */
export function upcomingFromContext(state: QueueState): { track: TrackSummary; orderIndex: number }[] {
  return state.order
    .slice(state.position + 1)
    .map((contextIndex, i) => ({ track: state.context[contextIndex]!, orderIndex: state.position + 1 + i }));
}

export function queueReducer(state: QueueState, action: QueueAction, random: () => number = Math.random): QueueState {
  const fromContext = (position: number, order = state.order): QueueState => ({
    ...state,
    order,
    position,
    current: state.context[order[position]!] ?? null,
    currentFrom: "context",
    playId: state.playId + 1,
  });

  switch (action.type) {
    case "playContext": {
      const { tracks, startIndex } = action;
      if (!tracks[startIndex]) return state;
      const order = state.shuffle ? shuffledOrder(tracks.length, startIndex, random) : range(tracks.length);
      return {
        ...state,
        context: tracks,
        contextLabel: action.label,
        order,
        position: state.shuffle ? 0 : startIndex,
        current: tracks[startIndex],
        currentFrom: "context",
        playId: state.playId + 1,
      };
    }

    case "next": {
      if (state.upNext.length > 0) {
        const [track, ...rest] = state.upNext;
        return { ...state, upNext: rest, current: track!, currentFrom: "queue", playId: state.playId + 1 };
      }
      if (state.position + 1 < state.order.length) return fromContext(state.position + 1);
      if (state.repeat === "all" && state.order.length > 0) {
        const order = state.shuffle ? shuffled(range(state.context.length), random) : state.order;
        return fromContext(0, order);
      }
      return state;
    }

    case "previous":
      if (state.currentFrom === "context" && state.position > 0) return fromContext(state.position - 1);
      // Nothing before this: start it again.
      return { ...state, playId: state.playId + 1 };

    case "replay":
      return { ...state, playId: state.playId + 1 };

    case "playNext":
      return { ...state, upNext: [action.track, ...state.upNext] };

    case "addToQueue":
      return { ...state, upNext: [...state.upNext, action.track] };

    case "removeFromQueue":
      return { ...state, upNext: state.upNext.filter((_, i) => i !== action.index) };

    case "jumpToQueued": {
      const track = state.upNext[action.index];
      if (!track) return state;
      return {
        ...state,
        upNext: state.upNext.slice(action.index + 1),
        current: track,
        currentFrom: "queue",
        playId: state.playId + 1,
      };
    }

    case "jumpToContext":
      if (action.orderIndex < 0 || action.orderIndex >= state.order.length) return state;
      return fromContext(action.orderIndex);

    case "toggleShuffle": {
      const shuffle = !state.shuffle;
      if (state.context.length === 0) return { ...state, shuffle };
      const playingIndex = state.position >= 0 ? state.order[state.position]! : 0;
      if (shuffle) {
        // Keep the current track where it is; shuffle everything after it.
        return { ...state, shuffle, order: shuffledOrder(state.context.length, playingIndex, random), position: 0 };
      }
      return { ...state, shuffle, order: range(state.context.length), position: playingIndex };
    }

    case "cycleRepeat": {
      const nextMode: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
      return { ...state, repeat: nextMode[state.repeat] };
    }
  }
}
