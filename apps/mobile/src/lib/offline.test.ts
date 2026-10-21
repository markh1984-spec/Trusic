import type { TrackSummary } from "@trusic/client";
import { describe, expect, it } from "vitest";
import { audioExtension, mayDownload, playableQueue, trackIdOfFile } from "./offline";

const track = (id: string) => ({ id, title: id }) as TrackSummary;

describe("offline listening on the phone", () => {
  it("keeps a format's extension so the phone's player can open the file", () => {
    expect(audioExtension("audio/mpeg")).toBe("mp3");
    expect(audioExtension("audio/wav; charset=binary")).toBe("wav");
    expect(audioExtension("audio/mp4")).toBe("m4a");
    expect(audioExtension("application/octet-stream")).toBe("audio");
  });

  it("tells finished downloads from partial ones", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(trackIdOfFile(`${id}.mp3`)).toBe(id);
    expect(trackIdOfFile(`${id}.part`)).toBeNull();
    expect(trackIdOfFile("notes.txt")).toBeNull();
  });

  it("queues only what can play offline, from the track tapped", () => {
    const tracks = ["a", "b", "c", "d"].map(track);
    const downloaded = new Set(["a", "c", "d"]);
    const canPlay = (t: TrackSummary) => downloaded.has(t.id);
    expect(playableQueue(tracks, 2, canPlay)).toEqual({ tracks: [track("a"), track("c"), track("d")], startIndex: 1 });
    expect(playableQueue(tracks, 1, canPlay)).toBeNull();
  });

  it("downloads on Wi-Fi only when asked to", () => {
    expect(mayDownload({ type: "WIFI", isConnected: true }, true, "ios")).toBe(true);
    expect(mayDownload({ type: "CELLULAR", isConnected: true }, true, "android")).toBe(false);
    expect(mayDownload({ type: "CELLULAR", isConnected: true }, false, "android")).toBe(true);
    expect(mayDownload({ type: "WIFI", isConnected: false }, false, "ios")).toBe(false);
    // A browser can't tell, so it doesn't hold downloads back.
    expect(mayDownload({ type: "UNKNOWN", isConnected: true }, true, "web")).toBe(true);
  });
});
