import type { TrackCredits } from "@trusic/client";

/** Editable form state for songwriting credits. */
export interface CreditsDraft {
  songwriters: string;
  societyMember: "yes" | "no" | "unsure";
  isCover: boolean;
  originalArtist: string;
  isrc: string;
}

export const emptyCredits: CreditsDraft = {
  songwriters: "",
  societyMember: "unsure",
  isCover: false,
  originalArtist: "",
  isrc: "",
};

export function toDraft(c: TrackCredits | null): CreditsDraft {
  if (!c) return emptyCredits;
  return {
    songwriters: c.songwriters.join(", "),
    societyMember: c.societyMember ?? "unsure",
    isCover: c.isCover,
    originalArtist: c.originalArtist ?? "",
    isrc: c.isrc ?? "",
  };
}

export function fromDraft(d: CreditsDraft): TrackCredits {
  return {
    songwriters: d.songwriters
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    societyMember: d.societyMember,
    isCover: d.isCover,
    ...(d.isCover && d.originalArtist.trim() ? { originalArtist: d.originalArtist.trim() } : {}),
    ...(d.isrc.trim() ? { isrc: d.isrc.trim() } : {}),
  };
}

/** Who wrote the song, and whether a collecting society (like PRS for Music) looks after it. */
export function CreditsFields({ value, onChange }: { value: CreditsDraft; onChange(next: CreditsDraft): void }) {
  const set = (patch: Partial<CreditsDraft>) => onChange({ ...value, ...patch });
  return (
    <>
      <label>
        Songwriters
        <input
          value={value.songwriters}
          onChange={(e) => set({ songwriters: e.target.value })}
          placeholder="e.g. Ellie Marsh, Tom Reid (comma separated)"
        />
      </label>
      <fieldset className="stage">
        <legend>
          Is any songwriter a member of PRS for Music, or another collecting society?
          <small className="muted"> Private: only you and Trusic see this.</small>
        </legend>
        <div className="segmented segmented--3">
          {(
            [
              ["yes", "Yes"],
              ["no", "No"],
              ["unsure", "Not sure"],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className={value.societyMember === v ? "segmented__on" : ""}>
              <input
                type="radio"
                name="societyMember"
                value={v}
                checked={value.societyMember === v}
                onChange={() => set({ societyMember: v })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="inline-check">
        <input type="checkbox" checked={value.isCover} onChange={(e) => set({ isCover: e.target.checked })} />
        This is a cover of someone else's song
      </label>
      {value.isCover ? (
        <label>
          Original artist
          <input value={value.originalArtist} onChange={(e) => set({ originalArtist: e.target.value })} />
        </label>
      ) : null}
      <label>
        ISRC
        <input
          value={value.isrc}
          onChange={(e) => set({ isrc: e.target.value })}
          placeholder="Optional, e.g. GB-ABC-26-00001"
        />
      </label>
    </>
  );
}
