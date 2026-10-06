/**
 * Wording for AI labels. Label names always come from `AI_LABELS` in @trusic/core,
 * so renaming a label there renames it everywhere in the app.
 */
import { AI_LABELS, aiLabel, type AiLabel } from "@trusic/core";

export const LABEL_ORDER: readonly AiLabel[] = ["human", "ai_assisted", "ai_generated"];

export const labelName = (label: AiLabel): string => AI_LABELS[label].name;

/** "Human-made · AI 0", shown on every track. The exact score always sits next to the label. */
export function badgeText(score: number): string {
  return `${labelName(aiLabel(score))} · AI ${score}`;
}

interface LabelCounts {
  trackCount: number;
  aiLabels: Record<AiLabel, number>;
}

/** "4 Human-made · 1 AI-generated" */
export function releaseAiSummary(r: LabelCounts): string {
  const parts = LABEL_ORDER.filter((l) => r.aiLabels[l] > 0).map((l) => `${r.aiLabels[l]} ${labelName(l)}`);
  return parts.join(" · ") || "No tracks yet";
}

/**
 * One label for a whole release, so AI albums are as obvious as AI tracks.
 * `label` is null for a mix of labels.
 */
export function releaseLabel(r: LabelCounts): { label: AiLabel | null; text: string } | null {
  if (r.trackCount === 0) return null;
  const only = LABEL_ORDER.find((l) => r.aiLabels[l] === r.trackCount);
  return only ? { label: only, text: labelName(only) } : { label: null, text: "Mixed" };
}
