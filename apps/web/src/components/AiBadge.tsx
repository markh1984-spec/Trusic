import { AI_LABELS, aiLabel } from "@trusic/core";

/** The label every track carries, everywhere it appears. */
export function AiBadge({ score, compact = false }: { score: number; compact?: boolean }) {
  const label = aiLabel(score);
  const { name, description } = AI_LABELS[label];
  const short = label === "human" ? "Human" : `AI ${score}`;
  return (
    <span className={`ai-badge ai-badge--${label}`} title={`${description} AI score ${score}/100.`}>
      <span className="ai-badge__dot" aria-hidden />
      {compact ? (
        short
      ) : (
        <>
          {/* Narrow screens show the short form. */}
          <span className="ai-badge__full">{`${name} · AI ${score}`}</span>
          <span className="ai-badge__short">{short}</span>
        </>
      )}
    </span>
  );
}
