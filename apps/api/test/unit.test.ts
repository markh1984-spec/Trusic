import { describe, expect, it } from "vitest";
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
