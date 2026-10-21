/**
 * What plays next. Pure state and transitions, kept apart from any audio
 * player so the rules (shuffle, repeat, "play next") are easy to test and the
 * web and mobile apps behave the same.
 *
 * - The context is the list playback started from (an album, a playlist, search
 *   results). `order` is the order its tracks play in, shuffled or not.
 * - `upNext` holds tracks the listener queued by hand. They play before the
 *   context carries on, like Spotify's queue.
 * - Radio is a context that never ends: the app adds more tracks to it
 *   (`extendContext`) whenever `radioNeedsMore` says it's running low.
 */
import type { PlaySource, RadioSeed, TrackSummary } from "@trusic/client";

export type RepeatMode = "off" | "all" | "one";

export interface QueueState {
  context: TrackSummary[];
  contextLabel: string | null;
  /** Where the context came from (an album, a playlist, search…), reported with each play for artists' stats. */
  contextSource: PlaySource | null;
  /** What the radio is based on, while radio is playing. */
  radio: RadioSeed | null;
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
  contextSource: null,
  radio: null,
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
  | {
      type: "playContext";
      tracks: TrackSummary[];
      startIndex: number;
      label: string | null;
      /** Where these tracks were picked from. Optional, so older callers still work. */
      source?: PlaySource | null;
      /** Set when this context is a radio station. */
      radio?: RadioSeed | null;
    }
  | { type: "extendContext"; tracks: TrackSummary[] }
  | { type: "next" }
  | { type: "previous" }
  | { type: "replay" }
  | { type: "playNext"; track: TrackSummary }
  | { type: "addToQueue"; track: TrackSummary }
  | { type: "removeFromQueue"; index: number }
  | { type: "jumpToQueued"; index: number }
  | { type: "jumpToContext"; orderIndex: number }
  | { type: "toggleShuffle" }
  | { type: "cycleRepeat" }
  /** A track can't be played any more (taken down, say): take it out of the queue, and move on if it's playing. */
  | { type: "dropTrack"; trackId: string };

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

/** Where the playing track was picked from, for artists' stats. Tracks queued by hand count as the queue. */
export function currentPlaySource(state: QueueState): PlaySource | null {
  if (!state.current) return null;
  if (state.currentFrom === "queue") return "queue";
  return state.contextSource ?? "other";
}

/** True when radio is playing and fewer than `ahead` of its tracks are left: time to add more. */
export function radioNeedsMore(state: QueueState, ahead = 3): boolean {
  return state.radio !== null && state.order.length - (state.position + 1) < ahead;
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
        contextSource: action.source ?? null,
        radio: action.radio ?? null,
        order,
        position: state.shuffle ? 0 : startIndex,
        current: tracks[startIndex],
        currentFrom: "context",
        playId: state.playId + 1,
      };
    }

    case "extendContext": {
      if (action.tracks.length === 0) return state;
      const added = range(action.tracks.length).map((i) => state.context.length + i);
      return {
        ...state,
        context: [...state.context, ...action.tracks],
        order: [...state.order, ...(state.shuffle ? shuffled(added, random) : added)],
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

    case "dropTrack":
      return dropTrack(state, action.trackId);
  }
}

/**
 * Take every copy of a track out of the queue. If it was playing, the next track starts (never the same one
 * again, even on "repeat one"); if nothing's left, the queue stops. Each drop shrinks the queue, so a queue of
 * nothing but unavailable tracks always comes to an end.
 */
function dropTrack(state: QueueState, trackId: string): QueueState {
  const gone = (t: TrackSummary) => t.id === trackId;
  const playingGone = state.current !== null && gone(state.current);
  if (!playingGone && !state.context.some(gone) && !state.upNext.some(gone)) return state;

  // Old context index → new one, or -1 for the dropped track.
  let kept = 0;
  const newIndex = state.context.map((t) => (gone(t) ? -1 : kept++));
  const order: number[] = [];
  // Still the last context track played: the one at the old position, or the one before it if that was dropped.
  let position = -1;
  for (const [i, contextIndex] of state.order.entries()) {
    const index = newIndex[contextIndex]!;
    if (index >= 0) order.push(index);
    if (i === state.position) position = order.length - 1;
  }
  const context = state.context.filter((t) => !gone(t));
  const upNext = state.upNext.filter((t) => !gone(t));
  const next: QueueState = { ...state, context, order, position, upNext };
  if (!playingGone) return next;

  const playId = state.playId + 1;
  if (upNext.length > 0) {
    const [track, ...rest] = upNext;
    return { ...next, upNext: rest, current: track!, currentFrom: "queue", playId };
  }
  const following = position + 1 < order.length ? position + 1 : state.repeat === "all" && order.length ? 0 : -1;
  if (following >= 0) {
    return { ...next, position: following, current: context[order[following]!]!, currentFrom: "context", playId };
  }
  // Nothing left to play. Radio stops too, rather than fetching more for a queue that has ended.
  return { ...next, current: null, currentFrom: null, radio: null, playId };
}
