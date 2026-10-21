import type { TrackSummary } from "@trusic/client";
import { AI_LABELS } from "@trusic/core";
import { useHumanOnly } from "../human-only";
import { useToast } from "../toast";

const EXPLAINER = `Leaves tracks labelled ${AI_LABELS.ai_assisted.name} and ${AI_LABELS.ai_generated.name} out of browsing, search, recommendations and radio. Albums and playlists you open yourself still play in full, with every track labelled.`;

/** The quick "Human-made only" switch in the top bar. */
export function HumanOnlyToggle() {
  const { humanOnly, setHumanOnly } = useHumanOnly();
  const toast = useToast();

  const flip = async () => {
    try {
      await setHumanOnly(!humanOnly);
      toast(humanOnly ? "Showing everything, labelled" : `${AI_LABELS.human.name} only`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't change the setting.");
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={humanOnly}
      className={`human-switch${humanOnly ? " human-switch--on" : ""}`}
      onClick={() => void flip()}
      title={EXPLAINER}
    >
      <span className="human-switch__track" aria-hidden>
        <span className="human-switch__thumb" />
      </span>
      <span className="human-switch__label">{AI_LABELS.human.name} only</span>
    </button>
  );
}

/**
 * On an album, playlist or artist page the listener opened themselves, everything still plays, with every track
 * labelled. When the switch is on, say so, so nothing is a surprise.
 */
export function OpenedYourselfNote({ tracks, what }: { tracks: TrackSummary[]; what: string }) {
  const { humanOnly } = useHumanOnly();
  const others = tracks.filter((t) => t.aiLabel !== "human").length;
  if (!humanOnly || others === 0) return null;
  return (
    <p className="note small opened-note">
      {AI_LABELS.human.name} only is on, but {what} plays in full because you opened it yourself.{" "}
      {others === 1 ? "1 track here is" : `${others} tracks here are`} labelled {AI_LABELS.ai_assisted.name} or{" "}
      {AI_LABELS.ai_generated.name}.
    </p>
  );
}
