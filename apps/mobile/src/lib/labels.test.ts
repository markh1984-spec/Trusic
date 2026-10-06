import { AI_LABELS } from "@trusic/core";
import { describe, expect, it } from "vitest";
import { badgeText, releaseAiSummary, releaseLabel } from "./labels";
import { duration, periodName } from "./format";

const counts = (human: number, ai_assisted: number, ai_generated: number) => ({
  trackCount: human + ai_assisted + ai_generated,
  aiLabels: { human, ai_assisted, ai_generated },
});

describe("labels", () => {
  it("takes every label name from @trusic/core", () => {
    expect(badgeText(0)).toBe(`${AI_LABELS.human.name} · AI 0`);
    expect(badgeText(25)).toBe(`${AI_LABELS.ai_assisted.name} · AI 25`);
    expect(badgeText(100)).toBe(`${AI_LABELS.ai_generated.name} · AI 100`);
  });

  it("labels a release by its tracks", () => {
    expect(releaseLabel(counts(0, 0, 0))).toBeNull();
    expect(releaseLabel(counts(4, 0, 0))).toEqual({ label: "human", text: AI_LABELS.human.name });
    expect(releaseLabel(counts(0, 0, 3))).toEqual({ label: "ai_generated", text: AI_LABELS.ai_generated.name });
    expect(releaseLabel(counts(2, 1, 0))?.label).toBeNull();
  });

  it("summarises a release's labels", () => {
    expect(releaseAiSummary(counts(4, 0, 1))).toBe(`4 ${AI_LABELS.human.name} · 1 ${AI_LABELS.ai_generated.name}`);
    expect(releaseAiSummary(counts(0, 0, 0))).toBe("No tracks yet");
  });
});

describe("format", () => {
  it("formats durations and payout months", () => {
    expect(duration(187_400)).toBe("3:07");
    expect(duration(-5)).toBe("0:00");
    expect(periodName("2026-09")).toBe("September 2026");
  });
});
