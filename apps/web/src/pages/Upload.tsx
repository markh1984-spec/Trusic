import {
  AI_LABELS,
  AI_STAGES,
  aiLabel,
  ASSISTIVE_TOOLS,
  DEFAULT_RUBRIC,
  payoutRatePercent,
  scoreDeclaration,
  type AiDeclaration,
  type AiStage,
  type AssistiveTool,
  type StageDeclaration,
} from "@trusic/core";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { AiBadge } from "../components/AiBadge";
import { ErrorNote, RequireAuth } from "../components/Guards";
import { TYPE_NAMES } from "../components/Cards";
import { CreditsFields, emptyCredits, fromDraft, type CreditsDraft } from "../components/CreditsFields";
import { ScoreBreakdown } from "../components/ScoreBreakdown";
import { useAsync } from "../hooks";

const LEVELS: { value: StageDeclaration; label: string; hint: string }[] = [
  { value: "none", label: "No AI", hint: "People did this" },
  { value: "assisted", label: "AI-assisted", hint: "A person led; AI helped. Free" },
  { value: "generated", label: "AI-generated", hint: "AI made it" },
  { value: "not_applicable", label: "Doesn't apply", hint: "e.g. no vocals" },
];

const TOOL_LABELS: Record<AssistiveTool, string> = {
  mastering: "AI mastering (e.g. LANDR, Ozone)",
  mixing: "AI mixing assistants",
  stem_separation: "Stem separation",
  audio_restoration: "Noise removal / restoration",
  pitch_correction: "Pitch correction",
  transcription: "Transcription / notation",
};

const EMPTY: AiDeclaration = {
  stages: { composition: "none", lyrics: "none", vocals: "none", instrumentation: "none", production: "none" },
  assistiveTools: [],
  toolsUsed: [],
};

export function UploadPage() {
  return (
    <RequireAuth>
      <UploadForm />
    </RequireAuth>
  );
}

function UploadForm() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const artists = me!.artists;

  const [artistId, setArtistId] = useState(artists[0]?.id ?? "");
  const [newArtist, setNewArtist] = useState("");
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [releaseId, setReleaseId] = useState(new URLSearchParams(location.search).get("release") ?? "");
  const artistSlug = artists.find((a) => a.id === artistId)?.slug;
  const releases = useAsync(
    () => (artistSlug ? api.artist(artistSlug).then((p) => p.releases) : Promise.resolve([])),
    [artistSlug],
  );
  const [file, setFile] = useState<File | null>(null);
  const [declaration, setDeclaration] = useState<AiDeclaration>(EMPTY);
  const [toolsText, setToolsText] = useState("");
  const [notes, setNotes] = useState("");
  const [credits, setCredits] = useState<CreditsDraft>(emptyCredits);
  const [honest, setHonest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const breakdown = useMemo(() => {
    try {
      return scoreDeclaration(declaration);
    } catch {
      return null;
    }
  }, [declaration]);

  const setStage = (stage: AiStage, value: StageDeclaration) =>
    setDeclaration((d) => ({ ...d, stages: { ...d.stages, [stage]: value } }));
  const toggleTool = (tool: AssistiveTool) =>
    setDeclaration((d) => ({
      ...d,
      assistiveTools: d.assistiveTools.includes(tool)
        ? d.assistiveTools.filter((t) => t !== tool)
        : [...d.assistiveTools, tool],
    }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !breakdown) return;
    setBusy(true);
    setError(null);
    try {
      let targetArtist = artistId;
      if (!targetArtist || targetArtist === "new") {
        const created = await api.createArtist({ name: newArtist.trim() });
        targetArtist = created.id;
        await refresh();
      }
      const track = await api.uploadTrack({
        artistId: targetArtist,
        title: title.trim(),
        genre: genre.trim() || undefined,
        // Only a release of the chosen artist (a ?release= link may point elsewhere).
        releaseId: releases.data?.some((r) => r.id === releaseId) ? releaseId : undefined,
        declaration: {
          ...declaration,
          toolsUsed: toolsText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        credits: fromDraft(credits),
        audio: file,
        filename: file.name,
      });
      navigate(`/track/${track.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const needsNewArtist = artists.length === 0 || artistId === "new";

  return (
    <form className="upload" onSubmit={submit}>
      <div className="upload__main">
        <h1>Upload a track</h1>

        <div className="card form">
          <h2>The track</h2>
          {artists.length ? (
            <label>
              Artist or band
              <select
                value={artistId}
                onChange={(e) => {
                  setArtistId(e.target.value);
                  setReleaseId("");
                }}
              >
                {artists.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value="new">+ New artist profile</option>
              </select>
            </label>
          ) : null}
          {needsNewArtist ? (
            <label>
              Artist or band name
              <input required maxLength={80} value={newArtist} onChange={(e) => setNewArtist(e.target.value)} />
            </label>
          ) : null}
          <label>
            Title
            <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Genre
            <input maxLength={60} value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Optional" />
          </label>
          {releases.data?.length && !needsNewArtist ? (
            <label>
              Release
              <select value={releaseId} onChange={(e) => setReleaseId(e.target.value)}>
                <option value="">None (a standalone track)</option>
                {releases.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({TYPE_NAMES[r.type]})
                  </option>
                ))}
              </select>
              <small className="muted">The track is added to the end of the release.</small>
            </label>
          ) : null}
          <label>
            Audio file
            <input
              type="file"
              required
              accept="audio/*,.mp3,.flac,.wav,.ogg,.aiff,.m4a"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <small className="muted">MP3, FLAC, WAV, OGG, AIFF or M4A.</small>
          </label>
        </div>

        <div className="card form">
          <h2>How was it made?</h2>
          <p className="muted">
            Tell us, part by part, how much AI was involved. Be honest: we also run detection, and tracks found to have
            more AI than declared get the higher score.
          </p>
          {AI_STAGES.map((stage) => (
            <fieldset key={stage} className="stage">
              <legend>
                {DEFAULT_RUBRIC.stages[stage].label}
                <small className="muted"> {DEFAULT_RUBRIC.stages[stage].description}</small>
              </legend>
              <div className="segmented">
                {LEVELS.map((level) => (
                  <label key={level.value} className={declaration.stages[stage] === level.value ? "segmented__on" : ""}>
                    <input
                      type="radio"
                      name={stage}
                      value={level.value}
                      checked={declaration.stages[stage] === level.value}
                      onChange={() => setStage(stage, level.value)}
                    />
                    <span>{level.label}</span>
                    <small>{level.hint}</small>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          <fieldset className="stage">
            <legend>
              AI engineering tools
              <small className="muted"> These are welcome and never affect your score.</small>
            </legend>
            <div className="checks">
              {ASSISTIVE_TOOLS.map((tool) => (
                <label key={tool}>
                  <input
                    type="checkbox"
                    checked={declaration.assistiveTools.includes(tool)}
                    onChange={() => toggleTool(tool)}
                  />
                  {TOOL_LABELS[tool]}
                </label>
              ))}
            </div>
          </fieldset>

          <label>
            AI products used
            <input
              value={toolsText}
              onChange={(e) => setToolsText(e.target.value)}
              placeholder="e.g. LANDR, Suno (comma separated)"
            />
          </label>
          <label>
            Anything else listeners should know?
            <textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        <div className="card form">
          <h2>Songwriting</h2>
          <p className="muted">
            Who wrote it? Songwriters are credited on the track. Trusic needs the rest to licence songs properly.
          </p>
          <CreditsFields value={credits} onChange={setCredits} />
        </div>
      </div>

      <aside className="upload__side">
        <div className="card">
          <h2>Your AI score</h2>
          {breakdown ? (
            <>
              <div className="score-summary">
                <div className={`score-dial score-dial--${aiLabel(breakdown.score)}`}>
                  <span className="score-dial__value">{breakdown.score}</span>
                  <span className="score-dial__label">AI score</span>
                </div>
                <div>
                  <AiBadge score={breakdown.score} />
                  <p className="muted small">{AI_LABELS[aiLabel(breakdown.score)].description}</p>
                </div>
              </div>
              <p>
                This track will earn <strong>{payoutRatePercent(breakdown.score)}%</strong> of the human rate per
                stream.
              </p>
              <ScoreBreakdown breakdown={breakdown} />
            </>
          ) : (
            <p className="note note--warn">At least one part has to apply to the track.</p>
          )}
          {error ? <ErrorNote message={error} /> : null}
          <label className="honest">
            <input type="checkbox" required checked={honest} onChange={(e) => setHonest(e.target.checked)} />
            This declaration is true. I understand Trusic can re-score the track if it finds otherwise.
          </label>
          <button className="button button--wide" disabled={busy || !breakdown || !file}>
            {busy ? "Uploading…" : "Upload track"}
          </button>
        </div>
      </aside>
    </form>
  );
}
