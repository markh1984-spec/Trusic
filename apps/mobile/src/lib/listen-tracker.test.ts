import { describe, expect, it } from "vitest";
import { ListenTracker } from "./listen-tracker";

/** Feed positions (seconds) as the player would, every quarter second. */
function play(tracker: ListenTracker, from: number, to: number, step = 0.25) {
  for (let t = from; t <= to + 1e-9; t += step) tracker.update(t);
}

describe("ListenTracker", () => {
  it("counts time heard", () => {
    const t = new ListenTracker();
    t.start("a");
    play(t, 0, 40);
    expect(t.take()).toEqual({ trackId: "a", msPlayed: 40_000 });
  });

  it("doesn't count seeking ahead, and keeps counting after a seek", () => {
    const t = new ListenTracker();
    t.start("a");
    play(t, 0, 10);
    t.seeked(120);
    play(t, 120, 125);
    expect(t.take()?.msPlayed).toBe(15_000);
  });

  it("ignores big jumps even when the seek wasn't reported", () => {
    const t = new ListenTracker();
    t.start("a");
    play(t, 0, 5);
    play(t, 90, 95);
    expect(t.take()?.msPlayed).toBe(10_000);
  });

  it("doesn't count seeking back as listening", () => {
    const t = new ListenTracker();
    t.start("a");
    play(t, 0, 20);
    t.update(5);
    play(t, 5, 10);
    expect(t.take()?.msPlayed).toBe(25_000);
  });

  it("doesn't count a paused player", () => {
    const t = new ListenTracker();
    t.start("a");
    play(t, 0, 3);
    for (let i = 0; i < 20; i++) t.update(3);
    expect(t.take()?.msPlayed).toBe(3_000);
  });

  it("never reports previews", () => {
    const t = new ListenTracker();
    t.start("a", { counts: false });
    play(t, 0, 30);
    expect(t.take()).toBeNull();
  });

  it("skips listens under a second and resets after each report", () => {
    const t = new ListenTracker();
    t.start("a");
    play(t, 0, 0.5);
    expect(t.take()).toBeNull();
    play(t, 0.75, 5);
    expect(t.take()?.msPlayed).toBe(4_500);
    expect(t.take()).toBeNull();
  });

  it("starts from zero for each new track", () => {
    const t = new ListenTracker();
    t.start("a");
    play(t, 0, 50);
    t.start("b");
    play(t, 0, 2);
    expect(t.take()).toEqual({ trackId: "b", msPlayed: 2_000 });
  });
});
