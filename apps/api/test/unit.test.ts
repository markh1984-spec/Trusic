import { describe, expect, it } from "vitest";
import { failureReason } from "../src/media/failures";
import { periodBounds, previousPeriod } from "../src/payout-service";
import { slugify } from "../src/routes/artists";
import { parseRange } from "../src/routes/listening";

describe("parseRange", () => {
  it("handles the range forms browsers send", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("rejects unsatisfiable or malformed ranges", () => {
    expect(parseRange("bytes=1000-", 1000)).toBeNull();
    expect(parseRange("bytes=50-10", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
    expect(parseRange("bytes=-0", 1000)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
  });
});

describe("failureReason", () => {
  it("says what went wrong with a conversion in plain words", () => {
    expect(failureReason("ffmpeg took longer than 610 seconds")).toMatch(/took too long/);
    expect(failureReason("ffmpeg failed (exit null): ")).toMatch(/ran out of memory/);
    expect(failureReason("ENOENT: no such file or directory, open '/data/originals/x.wav'")).toMatch(
      /couldn't find the file you uploaded/,
    );
    expect(failureReason("GET originals/x.wav: 404 NoSuchKey")).toMatch(/couldn't find the file/);
    expect(failureReason("Storage timed out: GET originals/x.wav")).toMatch(/couldn't reach the place it keeps files/);
    expect(failureReason("ffmpeg failed (exit 1): Output file #0 does not contain any stream")).toMatch(/damaged/);
    expect(failureReason("something new")).toBe("Something went wrong while converting it.");
    expect(failureReason(null)).toBe("Something went wrong while converting it.");
  });
});

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("Sigur Rós")).toBe("sigur-ros");
    expect(slugify("  AC/DC!! ")).toBe("ac-dc");
    expect(slugify("???")).toBe("artist");
  });
});

describe("periods", () => {
  it("covers a calendar month in UTC", () => {
    expect(periodBounds("2026-12").map((d) => d.toISOString())).toEqual([
      "2026-12-01T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
    ]);
    expect(previousPeriod("2026-01")).toBe("2025-12");
    expect(() => periodBounds("2026-13")).toThrow();
  });
});
