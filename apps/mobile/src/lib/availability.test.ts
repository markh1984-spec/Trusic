import type { TrackAvailability } from "@trusic/client";
import { describe, expect, it } from "vitest";
import { takenDownNotice, trackStatusNotice, UNAVAILABLE_PAGES } from "./availability";

const status = (over: Partial<TrackAvailability>): TrackAvailability => ({
  status: "processing",
  failure: null,
  takedown: null,
  ...over,
});

describe("things that aren't live", () => {
  it("tells the uploader their track is being prepared", () => {
    const n = trackStatusNotice(status({}), "uploader");
    expect(n.title).toBe("Getting this track ready");
    expect(n.action).toBeNull();
  });

  it("offers to try a failed upload again only when it can be", () => {
    const failed = (canRetry: boolean) =>
      trackStatusNotice(
        status({ status: "failed", failure: { reason: "The file was cut short.", canRetry } }),
        "uploader",
      );
    expect(failed(true).action).toEqual({ kind: "retry", label: "Try again" });
    expect(failed(true).paragraphs[0]).toBe("The file was cut short. Only you can see it.");
    expect(failed(false).action).toBeNull();
  });

  it("sends the uploader of a taken-down track to the website to send a counter-notice", () => {
    const takedown = {
      reportId: "r1",
      reference: "3F2A9C1B",
      reason: "copyright" as const,
      note: "The chorus copies another song.",
      status: "taken_down" as const,
      canCounterNotice: true,
    };
    const n = trackStatusNotice(status({ status: "taken_down", takedown }), "uploader");
    expect(n.paragraphs[0]).toContain("reported for copyright infringement");
    expect(n.paragraphs).toContain("Trusic's reason: “The chorus copies another song.”");
    expect(n.action).toEqual({ kind: "website", label: "Send a counter-notice", path: "/takedown/r1" });
    const sent = trackStatusNotice(
      status({ status: "taken_down", takedown: { ...takedown, canCounterNotice: false, status: "counter_notice" } }),
      "uploader",
    );
    expect(sent.action).toMatchObject({ label: "See the takedown" });
  });

  it("tells admins why they can see it", () => {
    const n = trackStatusNotice(status({ status: "suspended" }), "admin");
    expect(n.title).toBe("Hidden: the uploader's account is suspended");
    expect(n.paragraphs.at(-1)).toContain("because you're a Trusic admin");
  });

  it("explains taken-down pages, and has a friendly screen for anything that can't be opened", () => {
    expect(takenDownNotice("artist", true).text).toContain("only you and Trusic's admins");
    expect(takenDownNotice("artist", false).text).not.toContain("counter-notice");
    expect(takenDownNotice("playlist", true).title).toBe("This playlist has been taken down");
    expect(UNAVAILABLE_PAGES.release.title).toBe("This release isn't available");
  });
});
