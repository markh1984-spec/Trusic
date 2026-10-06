import { AI_LABELS, aiLabel } from "@trusic/core";

/** The label every track carries, everywhere it appears. */
export function AiBadge({ score, compact = false }: { score: number; compact?: boolean }) {
  const label = aiLabel(score);
  const { name, description } = AI_LABELS[label];
  return (
    <span className={`ai-badge ai-badge--${label}`} title={`${description} AI score ${score}/100.`}>
      <span className="ai-badge__dot" aria-hidden />
      {compact ? (label === "human" ? "Human" : `AI ${score}`) : `${name} · AI ${score}`}
    </span>
  );
}
