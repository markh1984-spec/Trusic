import type { ScoreBreakdown as Breakdown } from "@trusic/core";

const LEVEL_TEXT = {
  none: "No AI",
  assisted: "AI-assisted",
  generated: "AI-generated",
  not_applicable: "Doesn't apply",
} as const;

/** One bar per creative stage, filled by how much it adds to the score. */
export function ScoreBreakdown({ breakdown }: { breakdown: Breakdown }) {
  return (
    <ul className="breakdown">
      {breakdown.stages.map((s) => (
        <li key={s.stage} className={`breakdown__row breakdown__row--${s.declared}`}>
          <div className="breakdown__label">
            <span>{s.label}</span>
            <span className="breakdown__level">{LEVEL_TEXT[s.declared]}</span>
          </div>
          <div
            className="breakdown__bar"
            title={s.declared === "not_applicable" ? "" : `${Math.round(s.effectiveWeight)}% of the score`}
          >
            <span className="breakdown__weight" style={{ width: `${s.effectiveWeight}%` }}>
              <span
                className="breakdown__fill"
                style={{ width: `${s.effectiveWeight ? (s.points / s.effectiveWeight) * 100 : 0}%` }}
              />
            </span>
          </div>
          <span className="breakdown__points">
            {s.declared === "not_applicable" ? "–" : `+${Math.round(s.points)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
