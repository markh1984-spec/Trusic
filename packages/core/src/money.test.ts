import { describe, expect, it } from "vitest";
import { allocate, formatMoney } from "./money";

describe("allocate", () => {
  it("splits proportionally when it divides evenly", () => {
    expect(allocate(1000, [1, 1, 2])).toEqual([250, 250, 500]);
  });

  it("hands out every remaining penny, largest remainder first", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [3, 3, 4])).toEqual([3, 3, 4]);
    expect(allocate(7, [5, 2])).toEqual([5, 2]);
  });

  it("always sums to the total", () => {
    for (let total = 0; total < 500; total += 37) {
      const weights = [7, 13, 0, 29, 1, 3];
      const weightSum = weights.reduce((a, b) => a + b, 0);
      const shares = allocate(total, weights);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      shares.forEach((share, i) => {
        const exact = (total * weights[i]!) / weightSum;
        expect(Math.abs(share - exact)).toBeLessThan(1);
      });
    }
  });

  it("gives zero-weight entries nothing", () => {
    expect(allocate(99, [0, 3, 0])).toEqual([0, 99, 0]);
  });

  it("handles amounts and weights whose product overflows a double", () => {
    const shares = allocate(9_000_000_000_000, [4_000_000_000, 5_000_000_000]);
    expect(shares).toEqual([4_000_000_000_000, 5_000_000_000_000]);
  });

  it("rejects bad input instead of losing money", () => {
    expect(() => allocate(10, [0, 0])).toThrow(RangeError);
    expect(() => allocate(10, [])).toThrow(RangeError);
    expect(() => allocate(10.5, [1])).toThrow(RangeError);
    expect(() => allocate(-1, [1])).toThrow(RangeError);
    expect(() => allocate(10, [1.5])).toThrow(RangeError);
  });
});

describe("formatMoney", () => {
  it("formats minor units", () => {
    expect(formatMoney(540541, "GBP")).toBe("£5,405.41");
    expect(formatMoney(5, "USD", "en-US")).toBe("$0.05");
  });
});
