import type { TrackSummary } from "@trusic/client";
import { describe, expect, it } from "vitest";
import {
  currentPlaySource,
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

describe("play sources", () => {
  it("reports where the playing track came from, and the queue for hand-queued tracks", () => {
    let s = run([
      { type: "playContext", tracks: [track("a"), track("b")], startIndex: 0, label: "Album", source: "release" },
    ]);
    expect(currentPlaySource(s)).toBe("release");
    s = run([{ type: "addToQueue", track: track("q") }, { type: "next" }], s);
    expect([s.current?.id, currentPlaySource(s)]).toEqual(["q", "queue"]);
    s = run([{ type: "next" }], s);
    expect([s.current?.id, currentPlaySource(s)]).toEqual(["b", "release"]);
  });

  it("works for callers that don't say where tracks came from", () => {
    expect(currentPlaySource(initialQueue)).toBeNull();
    const s = run([{ type: "playContext", tracks: [track("a")], startIndex: 0, label: null }]);
    expect(currentPlaySource(s)).toBe("other");
    expect(s.radio).toBeNull();
  });
});

describe("radio", () => {
  const seed = { type: "track" as const, id: "a" };
  const start = () =>
    run([
      {
        type: "playContext",
        tracks: ["a", "b", "c", "d"].map(track),
        startIndex: 0,
        label: "a radio",
        source: "radio",
        radio: seed,
      },
    ]);

  it("asks for more tracks as it runs low, and plays on when they arrive", () => {
    let s = start();
    expect(s.radio).toEqual(seed);
    expect(radioNeedsMore(s)).toBe(false);
    s = run([{ type: "next" }], s);
    expect(radioNeedsMore(s)).toBe(true);
    s = run([{ type: "extendContext", tracks: ["e", "f", "g"].map(track) }], s);
    expect(radioNeedsMore(s)).toBe(false);
    expect(ids(upcomingFromContext(s))).toEqual(["c", "d", "e", "f", "g"]);
    s = run([{ type: "next" }, { type: "next" }, { type: "next" }], s);
    expect([s.current?.id, currentPlaySource(s)]).toEqual(["e", "radio"]);
    expect(hasNext(s)).toBe(true);
  });

  it("stops being radio when something else is played", () => {
    const s = run(
      [{ type: "playContext", tracks: [track("x")], startIndex: 0, label: "Album", source: "release" }],
      start(),
    );
    expect(s.radio).toBeNull();
    expect(radioNeedsMore(s)).toBe(false);
  });

  it("shuffles added tracks among themselves, after what's already lined up", () => {
    let s = run([{ type: "toggleShuffle" }], start());
    const before = ids(upcomingFromContext(s));
    s = run([{ type: "extendContext", tracks: ["e", "f", "g"].map(track) }], s);
    const after = ids(upcomingFromContext(s));
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).sort()).toEqual(["e", "f", "g"]);
  });

  it("ignores an empty batch", () => {
    const s = start();
    expect(run([{ type: "extendContext", tracks: [] }], s)).toBe(s);
  });
});
