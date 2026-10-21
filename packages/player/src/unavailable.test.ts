import type { TrackSummary } from "@trusic/client";
import { describe, expect, it } from "vitest";
import {
  hasNext,
  initialQueue,
  queueReducer,
  radioNeedsMore,
  upcomingFromContext,
  type QueueAction,
  type QueueState,
} from "./queue";

const track = (id: string) => ({ id, title: id }) as TrackSummary;
const ids = (tracks: { track: TrackSummary }[]) => tracks.map((t) => t.track.id);

function run(actions: QueueAction[], state: QueueState = initialQueue): QueueState {
  return actions.reduce((s, a) => queueReducer(s, a, () => 0.5), state);
}

const play = (names: string[], startIndex = 0): QueueAction => ({
  type: "playContext",
  tracks: names.map(track),
  startIndex,
  label: "Album",
  source: "release",
});

describe("a track that can't be played any more", () => {
  it("is skipped when it's playing, and the queue carries on", () => {
    let s = run([play(["a", "b", "c"], 1)]);
    s = run([{ type: "dropTrack", trackId: "b" }], s);
    expect(s.current?.id).toBe("c");
    expect(s.currentFrom).toBe("context");
    expect(s.context.map((t) => t.id)).toEqual(["a", "c"]);
    // Previous goes back to the track before the one that went.
    expect(run([{ type: "previous" }], s).current?.id).toBe("a");
  });

  it("starts the next track afresh", () => {
    const s = run([play(["a", "b"])]);
    expect(run([{ type: "dropTrack", trackId: "a" }], s).playId).toBe(s.playId + 1);
  });

  it("is taken out of what's still to come without interrupting the music", () => {
    let s = run([play(["a", "b", "c", "b"]), { type: "addToQueue", track: track("b") }]);
    s = run([{ type: "dropTrack", trackId: "b" }], s);
    expect(s.current?.id).toBe("a");
    expect(s.upNext).toEqual([]);
    expect(ids(upcomingFromContext(s))).toEqual(["c"]);
  });

  it("keeps the playing track's place when an earlier one goes", () => {
    let s = run([play(["a", "b", "c", "d"], 2)]);
    const playId = s.playId;
    s = run([{ type: "dropTrack", trackId: "a" }], s);
    expect([s.current?.id, s.playId]).toEqual(["c", playId]);
    expect(ids(upcomingFromContext(s))).toEqual(["d"]);
  });

  it("plays tracks queued by hand next", () => {
    let s = run([play(["a", "b"]), { type: "addToQueue", track: track("q") }]);
    s = run([{ type: "dropTrack", trackId: "a" }], s);
    expect([s.current?.id, s.currentFrom]).toEqual(["q", "queue"]);
    expect(run([{ type: "next" }], s).current?.id).toBe("b");
  });

  it("isn't repeated on repeat one", () => {
    let s = run([play(["a", "b"]), { type: "cycleRepeat" }, { type: "cycleRepeat" }]);
    expect(s.repeat).toBe("one");
    s = run([{ type: "dropTrack", trackId: "a" }], s);
    expect(s.current?.id).toBe("b");
  });

  it("goes round again on repeat all", () => {
    let s = run([play(["a", "b", "c"], 2), { type: "cycleRepeat" }]);
    s = run([{ type: "dropTrack", trackId: "c" }], s);
    expect(s.current?.id).toBe("a");
  });

  it("stops the queue when nothing's left, even on repeat all", () => {
    let s = run([play(["a", "b"]), { type: "cycleRepeat" }]);
    s = run([{ type: "dropTrack", trackId: "a" }], s);
    expect(s.current?.id).toBe("b");
    s = run([{ type: "dropTrack", trackId: "b" }], s);
    expect(s.current).toBeNull();
    expect(hasNext(s)).toBe(false);
  });

  it("stops at the end of the list", () => {
    const s = run([play(["a", "b"], 1), { type: "dropTrack", trackId: "b" }]);
    expect(s.current).toBeNull();
    expect(s.context.map((t) => t.id)).toEqual(["a"]);
  });

  it("keeps a shuffled order", () => {
    let s = run([play(["a", "b", "c", "d"]), { type: "toggleShuffle" }]);
    const before = ids(upcomingFromContext(s));
    s = run([{ type: "dropTrack", trackId: before[0]! }], s);
    expect(ids(upcomingFromContext(s))).toEqual(before.slice(1));
    expect(s.current?.id).toBe("a");
  });

  it("lets radio carry on, topping up as usual", () => {
    let s = run([
      {
        type: "playContext",
        tracks: ["a", "b", "c", "d"].map(track),
        startIndex: 0,
        label: "a radio",
        source: "radio",
        radio: { type: "track", id: "a" },
      },
    ]);
    s = run([{ type: "dropTrack", trackId: "a" }], s);
    expect(s.current?.id).toBe("b");
    expect(s.radio).not.toBeNull();
    expect(radioNeedsMore(s)).toBe(true);
  });

  it("changes nothing for a track that isn't queued", () => {
    const s = run([play(["a", "b"])]);
    expect(run([{ type: "dropTrack", trackId: "x" }], s)).toBe(s);
  });
});
