import { describe, expect, it } from "vitest";
import {
  aiLabel,
  InvalidDeclarationError,
  parseAiDeclaration,
  payoutRatePercent,
  resolveAiScore,
  scoreDeclaration,
  type AiDeclaration,
  type DetectionResult,
  type StageDeclaration,
} from "./ai-score";

function declaration(stages: Partial<Record<keyof AiDeclaration["stages"], StageDeclaration>> = {}): AiDeclaration {
  return {
    stages: {
      composition: "none",
      lyrics: "none",
      vocals: "none",
      instrumentation: "none",
      production: "none",
      ...stages,
    },
    assistiveTools: [],
    toolsUsed: [],
  };
}

const ALL_GENERATED = declaration({
  composition: "generated",
  lyrics: "generated",
  vocals: "generated",
  instrumentation: "generated",
  production: "generated",
});

describe("scoreDeclaration", () => {
  it("scores a band playing their own song as 0", () => {
    expect(scoreDeclaration(declaration()).score).toBe(0);
  });

  it("ignores AI mastering, mixing and other engineering tools", () => {
    const d: AiDeclaration = { ...declaration(), assistiveTools: ["mastering", "mixing", "stem_separation"] };
    expect(scoreDeclaration(d).score).toBe(0);
  });

  it("scores a fully prompt-generated song as 100", () => {
    expect(scoreDeclaration(ALL_GENERATED).score).toBe(100);
  });

  it("scores a fully generated instrumental as 100 by ignoring the stages it doesn't have", () => {
    const d = declaration({
      composition: "generated",
      lyrics: "not_applicable",
      vocals: "not_applicable",
      instrumentation: "generated",
      production: "generated",
    });
    expect(scoreDeclaration(d).score).toBe(100);
  });

  it("scores a human-written song performed by AI as mostly AI", () => {
    // You wrote the words, the AI did everything else.
    const d = declaration({
      composition: "generated",
      vocals: "generated",
      instrumentation: "generated",
      production: "generated",
    });
    expect(scoreDeclaration(d).score).toBe(85);
    expect(aiLabel(85)).toBe("ai_generated");
  });

  it("penalises an AI voice on an otherwise human track", () => {
    expect(scoreDeclaration(declaration({ vocals: "generated" })).score).toBe(25);
  });

  it("doesn't charge for AI-assisted work, only AI-generated parts", () => {
    expect(scoreDeclaration(declaration({ lyrics: "assisted", composition: "assisted" })).score).toBe(0);
    expect(scoreDeclaration(declaration({ composition: "assisted", vocals: "generated" })).score).toBe(25);
  });

  it("reports per-stage points that add up to the score", () => {
    const breakdown = scoreDeclaration(declaration({ composition: "assisted", vocals: "generated" }));
    const points = breakdown.stages.reduce((a, s) => a + s.points, 0);
    expect(Math.round(points)).toBe(breakdown.score);
    expect(breakdown.stages.reduce((a, s) => a + s.effectiveWeight, 0)).toBeCloseTo(100);
  });
});

describe("parseAiDeclaration", () => {
  it("accepts a valid declaration and dedupes tools", () => {
    const parsed = parseAiDeclaration({
      stages: declaration().stages,
      assistiveTools: ["mastering", "mastering"],
      toolsUsed: [" LANDR ", "LANDR"],
    });
    expect(parsed.assistiveTools).toEqual(["mastering"]);
    expect(parsed.toolsUsed).toEqual(["LANDR"]);
  });

  it("rejects missing or unknown stage values", () => {
    expect(() => parseAiDeclaration({ stages: { composition: "none" } })).toThrow(InvalidDeclarationError);
    expect(() => parseAiDeclaration({ stages: { ...declaration().stages, vocals: "a-bit" } })).toThrow(
      InvalidDeclarationError,
    );
    expect(() => parseAiDeclaration(null)).toThrow(InvalidDeclarationError);
  });

  it("rejects a track where nothing applies", () => {
    const stages = Object.fromEntries(Object.keys(declaration().stages).map((k) => [k, "not_applicable"]));
    expect(() => parseAiDeclaration({ stages })).toThrow(InvalidDeclarationError);
  });

  it("rejects unknown assistive tools", () => {
    expect(() => parseAiDeclaration({ stages: declaration().stages, assistiveTools: ["songwriting"] })).toThrow(
      InvalidDeclarationError,
    );
  });
});

describe("resolveAiScore", () => {
  const confidentAi: DetectionResult = {
    detector: "test",
    verdict: "likely_ai",
    confidence: 0.97,
    estimatedScore: 100,
    evidence: [],
  };

  it("uses the declaration when detection agrees or is unsure", () => {
    expect(resolveAiScore({ declaredScore: 0 })).toMatchObject({ score: 0, source: "declared", flagged: false });
    expect(resolveAiScore({ declaredScore: 0, detection: { ...confidentAi, verdict: "inconclusive" } })).toMatchObject({
      score: 0,
      source: "declared",
    });
  });

  it("raises the score when detection confidently finds undeclared AI", () => {
    expect(resolveAiScore({ declaredScore: 0, detection: confidentAi })).toMatchObject({
      score: 100,
      source: "detected",
      flagged: true,
    });
  });

  it("ignores low-confidence detection", () => {
    expect(resolveAiScore({ declaredScore: 0, detection: { ...confidentAi, confidence: 0.6 } }).score).toBe(0);
  });

  it("tolerates small disagreements", () => {
    const detection = { ...confidentAi, estimatedScore: 30 };
    expect(resolveAiScore({ declaredScore: 25, detection }).score).toBe(25);
  });

  it("never lowers a declared score", () => {
    const detection: DetectionResult = { ...confidentAi, verdict: "likely_human", estimatedScore: 0 };
    expect(resolveAiScore({ declaredScore: 85, detection }).score).toBe(85);
  });

  it("lets a human review decision override everything", () => {
    expect(resolveAiScore({ declaredScore: 0, detection: confidentAi, reviewScore: 0 })).toMatchObject({
      score: 0,
      source: "review",
      flagged: false,
    });
  });
});

describe("labels and rates", () => {
  it("labels by score", () => {
    expect(aiLabel(0)).toBe("human");
    expect(aiLabel(9)).toBe("human");
    expect(aiLabel(10)).toBe("ai_assisted");
    expect(aiLabel(69)).toBe("ai_assisted");
    expect(aiLabel(70)).toBe("ai_generated");
    expect(aiLabel(100)).toBe("ai_generated");
  });

  it("pays (100 - score)% of the human rate", () => {
    expect(payoutRatePercent(0)).toBe(100);
    expect(payoutRatePercent(20)).toBe(80);
    expect(payoutRatePercent(100)).toBe(0);
  });
});
