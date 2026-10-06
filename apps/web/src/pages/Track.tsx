import type { Split, TrackDetail } from "@trusic/client";
import { AI_LABELS } from "@trusic/core";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { AiBadge } from "../components/AiBadge";
import { Artwork } from "../components/Artwork";
import { ErrorNote, Loading } from "../components/Guards";
import { Icon } from "../components/Icon";
import { LikeButton } from "../components/LikeButton";
import { ScoreBreakdown } from "../components/ScoreBreakdown";
import { TrackMenu } from "../components/TrackMenu";
import { duration, money } from "../format";
import { useAuth } from "../auth";
import { useAsync } from "../hooks";
import { usePlayer, usePlayTracks } from "../player";

const TOOL_NAMES: Record<string, string> = {
  mastering: "Mastering",
  mixing: "Mixing",
  stem_separation: "Stem separation",
  audio_restoration: "Audio restoration",
  pitch_correction: "Pitch correction",
  transcription: "Transcription",
};

const SOURCE_TEXT = {
  declared: "Score from the artist's own declaration.",
  detected: "Our detection found more AI than the artist declared, so the higher score applies.",
  review: "Score set by Trusic's review team.",
} as const;

export function TrackPage() {
  const { id = "" } = useParams();
  const { data: track, error, loading, reload } = useAsync(() => api.track(id), [id]);
  const play = usePlayTracks();
  const player = usePlayer();
  const { me } = useAuth();

  if (error) return <ErrorNote message={error} />;
  if (loading || !track) return <Loading />;

  const isCurrent = player.current?.id === track.id;
  const label = AI_LABELS[track.aiLabel];
  const d = track.declaration;

  return (
    <>
      <section className="track-hero">
        <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={200} />
        <div>
          <p className="eyebrow">Track{track.genre ? ` · ${track.genre}` : ""}</p>
          <h1>{track.title}</h1>
          <p>
            <Link to={`/artist/${track.artist.slug}`}>{track.artist.name}</Link>
            {track.release ? (
              <>
                <span className="muted"> · </span>
                <Link to={`/release/${track.release.id}`}>{track.release.title}</Link>
              </>
            ) : null}
            <span className="muted"> · {duration(track.durationMs)}</span>
          </p>
          <div className="track-hero__actions">
            <button
              className="play-button play-button--large"
              onClick={() => (isCurrent ? player.toggle() : play([track], 0))}
              aria-label={isCurrent && player.playing ? "Pause" : "Play"}
            >
              <Icon name={isCurrent && player.playing ? "pause" : "play"} size={26} />
            </button>
            <AiBadge score={track.aiScore} />
            <LikeButton trackId={track.id} title={track.title} size={24} />
            <TrackMenu track={track} />
          </div>
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <h2>AI transparency</h2>
          <div className="score-summary">
            <div className={`score-dial score-dial--${track.aiLabel}`}>
              <span className="score-dial__value">{track.aiScore}</span>
              <span className="score-dial__label">AI score</span>
            </div>
            <div>
              <p className="score-summary__name">{label.name}</p>
              <p className="muted">{label.description}</p>
              <p>
                Earns <strong>{track.payoutRatePercent}%</strong> of the human rate per stream.
              </p>
            </div>
          </div>
          <p className="muted small">{SOURCE_TEXT[track.scoreSource]}</p>
          <h3>What the artist declared</h3>
          <ScoreBreakdown breakdown={track.breakdown} />
          {d.assistiveTools.length ? (
            <p className="small">
              <strong>AI engineering tools (never affect the score):</strong>{" "}
              {d.assistiveTools.map((t) => TOOL_NAMES[t] ?? t).join(", ")}
            </p>
          ) : null}
          {d.toolsUsed.length ? (
            <p className="small">
              <strong>Tools named:</strong> {d.toolsUsed.join(", ")}
            </p>
          ) : null}
          {d.notes ? <blockquote className="small">{d.notes}</blockquote> : null}
          {track.detection && track.detection.verdict !== "inconclusive" ? (
            <div className={`note ${track.detection.verdict === "likely_ai" ? "note--warn" : ""}`}>
              <strong>Detection ({track.detection.detector}):</strong>{" "}
              {track.detection.verdict === "likely_ai" ? "likely AI-generated" : "likely human"},{" "}
              {Math.round(track.detection.confidence * 100)}% confidence.
              {track.detection.evidence.length ? (
                <ul>
                  {track.detection.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="stack">
          {track.isOwner ? <OwnerPanel track={track} onChange={reload} /> : <HowPaidCard track={track} />}
          {me?.user.isAdmin ? <AdminTrackCard track={track} onChange={reload} /> : null}
        </div>
      </section>
    </>
  );
}

/** Admins can re-score a track, or record a false declaration as a strike. */
function AdminTrackCard({ track, onChange }: { track: TrackDetail; onChange(): void }) {
  const [score, setScore] = useState(String(track.aiScore));
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (work: () => Promise<string>) => {
    setError(null);
    setMessage(null);
    try {
      setMessage(await work());
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    }
  };

  return (
    <div className="card card--admin">
      <h2>Admin</h2>
      <p className="muted small">
        Declared {track.declaredScore}, currently {track.aiScore} ({track.scoreSource}).
      </p>
      {error ? <ErrorNote message={error} /> : null}
      {message ? <p className="note note--ok small">{message}</p> : null}
      <div className="form">
        <label>
          Score
          <input type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} />
        </label>
        <button
          className="button button--ghost"
          onClick={() =>
            void act(async () => {
              await api.reviewTrack(track.id, { score: Number(score) });
              return `Score set to ${score}.`;
            })
          }
        >
          Set score (no strike)
        </button>
        <label>
          Why this is a false declaration
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button
          className="button button--danger"
          disabled={reason.trim().length < 5}
          onClick={() => {
            if (
              !window.confirm(
                "Issue a strike? Past earnings will be clawed back, and three strikes suspends the account.",
              )
            ) {
              return;
            }
            void act(async () => {
              const r = await api.strikeTrack(track.id, { score: Number(score), reason: reason.trim() });
              return `Strike ${r.strikeCount} issued. ${money(r.strike.clawbackTotal)} clawed back.${r.suspended ? " The account is now suspended." : ""}`;
            });
          }}
        >
          Strike: false declaration
        </button>
      </div>
    </div>
  );
}

function HowPaidCard({ track }: { track: TrackDetail }) {
  return (
    <div className="card">
      <h2>How this track gets paid</h2>
      <p>
        When a Premium listener plays this track, part of that listener's 80% artist share comes here. Each stream is
        weighted by <strong>{track.payoutRatePercent}%</strong>, so the score cuts this track's per-stream rate and the
        difference goes to the human-made tracks the same listener played.
      </p>
      <p className="muted small">
        Example: a listener plays this and a human-made track 10 times each. The human track earns 100 units per stream
        and this one earns {track.payoutRatePercent}.
      </p>
      <Link to="/transparency">How Trusic pays artists →</Link>
    </div>
  );
}

function OwnerPanel({ track, onChange }: { track: TrackDetail; onChange(): void }) {
  return (
    <div className="stack">
      <AppealCard track={track} onChange={onChange} />
      <SplitsCard trackId={track.id} />
    </div>
  );
}

function AppealCard({ track, onChange }: { track: TrackDetail; onChange(): void }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const appeal = track.appeal;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.appeal(track.id, message);
      setMessage("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your appeal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Your score</h2>
      {track.flagged ? (
        <p className="note note--warn">
          Detection raised this track from your declared {track.declaredScore} to {track.aiScore}. If that's wrong, tell
          us how it was made and a person will review it.
        </p>
      ) : (
        <p className="muted">
          You declared {track.declaredScore}; the current score is {track.aiScore}. If you think it's wrong, you can ask
          for a review.
        </p>
      )}
      {appeal ? (
        <p className={`note ${appeal.status === "open" ? "" : appeal.status === "upheld" ? "note--ok" : "note--warn"}`}>
          Appeal {appeal.status === "open" ? "under review" : appeal.status}
          {appeal.resolvedScore !== null ? `: score set to ${appeal.resolvedScore}` : ""}.
          {appeal.resolutionNote ? ` “${appeal.resolutionNote}”` : ""}
        </p>
      ) : null}
      {appeal?.status !== "open" ? (
        <form className="form" onSubmit={submit}>
          {error ? <ErrorNote message={error} /> : null}
          <label>
            Ask for a review
            <textarea
              rows={3}
              minLength={10}
              required
              placeholder="How was this track made? Project files, stems and session photos all help."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <button className="button button--ghost" disabled={busy}>
            {busy ? "Sending…" : "Request review"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function SplitsCard({ trackId }: { trackId: string }) {
  const { data, error, loading, reload } = useAsync(() => api.splits(trackId), [trackId]);
  const [editing, setEditing] = useState<{ email: string; percent: string }[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEditing = (splits: Split[]) =>
    setEditing(splits.map((s) => ({ email: s.email, percent: String(s.shareBps / 100) })));
  const total = editing?.reduce((acc, r) => acc + (Number(r.percent) || 0), 0) ?? 0;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    try {
      await api.setSplits(
        trackId,
        editing!.map((r) => ({ email: r.email.trim(), shareBps: Math.round(Number(r.percent) * 100) })),
      );
      setEditing(null);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save the splits.");
    }
  };

  return (
    <div className="card">
      <h2>Who gets paid</h2>
      <p className="muted small">Split this track's earnings between band members. Everyone needs a Trusic account.</p>
      {error ? <ErrorNote message={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && !editing ? (
        <>
          <ul className="plain-list">
            {data.map((s) => (
              <li key={s.userId}>
                <span>{s.displayName}</span> <span className="muted">{s.email}</span>{" "}
                <strong>{s.shareBps / 100}%</strong>
              </li>
            ))}
          </ul>
          <button className="button button--ghost" onClick={() => startEditing(data)}>
            Edit splits
          </button>
        </>
      ) : null}
      {editing ? (
        <form className="form" onSubmit={save}>
          {saveError ? <ErrorNote message={saveError} /> : null}
          {editing.map((row, i) => (
            <div className="split-row" key={i}>
              <input
                type="email"
                required
                placeholder="member@email.com"
                value={row.email}
                onChange={(e) => setEditing(editing.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))}
              />
              <input
                type="number"
                min={0.01}
                max={100}
                step={0.01}
                required
                value={row.percent}
                onChange={(e) => setEditing(editing.map((r, j) => (j === i ? { ...r, percent: e.target.value } : r)))}
                aria-label="Percent"
              />
              <span>%</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setEditing(editing.filter((_, j) => j !== i))}
                aria-label="Remove"
                disabled={editing.length === 1}
              >
                ×
              </button>
            </div>
          ))}
          <p className={Math.abs(total - 100) < 0.001 ? "muted small" : "note note--warn small"}>Total: {total}%</p>
          <div className="row">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setEditing([...editing, { email: "", percent: "0" }])}
            >
              Add member
            </button>
            <button className="button">Save</button>
            <button type="button" className="button button--ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
