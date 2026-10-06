import type { TrackSummary } from "@trusic/client";
import { describe, expect, it } from "vitest";
import { hasNext, initialQueue, queueReducer, upcomingFromContext, type QueueAction, type QueueState } from "./queue";

const track = (id: string) => ({ id, title: id }) as TrackSummary;
const album = ["a", "b", "c", "d"].map(track);

/** Deterministic "random" so shuffles are predictable. */
const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

function run(actions: QueueAction[], state: QueueState = initialQueue, random = seq([0.5])): QueueState {
  return actions.reduce((s, a) => queueReducer(s, a, random), state);
}

const titles = (s: QueueState) => s.current?.id;

describe("queue", () => {
  it("plays a context in order from where you start", () => {
    let s = run([{ type: "playContext", tracks: album, startIndex: 1, label: "Album" }]);
    expect(titles(s)).toBe("b");
    s = run([{ type: "next" }, { type: "next" }], s);
    expect(titles(s)).toBe("d");
    expect(hasNext(s)).toBe(false);
    const ended = run([{ type: "next" }], s);
    expect(ended).toBe(s);
  });

  it("restarts the playId on every new track, including replays", () => {
    const s = run([{ type: "playContext", tracks: album, startIndex: 0, label: null }]);
    expect(run([{ type: "replay" }], s).playId).toBe(s.playId + 1);
    expect(run([{ type: "next" }], s).playId).toBe(s.playId + 1);
  });

  it("plays queued tracks before carrying on with the context", () => {
    let s = run([
      { type: "playContext", tracks: album, startIndex: 0, label: null },
      { type: "addToQueue", track: track("q1") },
      { type: "playNext", track: track("q0") },
    ]);
    s = run([{ type: "next" }], s);
    expect([titles(s), s.currentFrom]).toEqual(["q0", "queue"]);
    s = run([{ type: "next" }], s);
    expect(titles(s)).toBe("q1");
    s = run([{ type: "next" }], s);
    expect(titles(s)).toBe("b");
  });

  it("goes back within the context, or restarts the track", () => {
    let s = run([{ type: "playContext", tracks: album, startIndex: 2, label: null }, { type: "previous" }]);
    expect(titles(s)).toBe("b");
    s = run([{ type: "playContext", tracks: album, startIndex: 0, label: null }]);
    const again = run([{ type: "previous" }], s);
    expect([titles(again), again.playId]).toEqual(["a", s.playId + 1]);
  });

  it("repeats the whole context", () => {
    let s = run([{ type: "playContext", tracks: album, startIndex: 3, label: null }, { type: "cycleRepeat" }]);
    expect(s.repeat).toBe("all");
    expect(hasNext(s)).toBe(true);
    s = run([{ type: "next" }], s);
    expect(titles(s)).toBe("a");
  });

  it("cycles repeat off → all → one → off", () => {
    const modes = [1, 2, 3].map((n) => run(Array.from({ length: n }, () => ({ type: "cycleRepeat" }) as const)).repeat);
    expect(modes).toEqual(["all", "one", "off"]);
  });

  it("shuffles everything after the track you picked, and unshuffles back to album order", () => {
    let s = run(
      [{ type: "toggleShuffle" }, { type: "playContext", tracks: album, startIndex: 2, label: null }],
      initialQueue,
      seq([0]),
    );
    expect(titles(s)).toBe("c");
    expect(s.order[0]).toBe(2);
    expect([...s.order].sort()).toEqual([0, 1, 2, 3]);

    s = run([{ type: "toggleShuffle" }], s);
    expect(s.order).toEqual([0, 1, 2, 3]);
    expect(s.position).toBe(2);
    expect(upcomingFromContext(s).map((u) => u.track.id)).toEqual(["d"]);
  });

  it("jumps to a queued or upcoming track", () => {
    let s = run([
      { type: "playContext", tracks: album, startIndex: 0, label: null },
      { type: "addToQueue", track: track("q1") },
      { type: "addToQueue", track: track("q2") },
      { type: "jumpToQueued", index: 1 },
    ]);
    expect([titles(s), s.upNext.length]).toEqual(["q2", 0]);
    s = run([{ type: "jumpToContext", orderIndex: 3 }], s);
    expect(titles(s)).toBe("d");
  });

  it("removes a queued track", () => {
    const s = run([
      { type: "addToQueue", track: track("q1") },
      { type: "addToQueue", track: track("q2") },
      { type: "removeFromQueue", index: 0 },
    ]);
    expect(s.upNext.map((t) => t.id)).toEqual(["q2"]);
  });
});
