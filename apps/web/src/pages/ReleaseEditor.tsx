import type { ArtistPage, ReleaseDetail, ReleaseType } from "@trusic/client";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { AiBadge } from "../components/AiBadge";
import { Artwork } from "../components/Artwork";
import { ErrorNote, Loading, RequireAuth } from "../components/Guards";
import { Icon } from "../components/Icon";
import { ImagePicker } from "../components/ImagePicker";
import { duration } from "../format";
import { useToast } from "../toast";

export function ReleaseEditorPage() {
  return (
    <RequireAuth>
      <ReleaseEditor />
    </RequireAuth>
  );
}

function ReleaseEditor() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [release, setRelease] = useState<ReleaseDetail | null>(null);
  const [artistPage, setArtistPage] = useState<ArtistPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .release(id)
      .then(async (r) => {
        const page = await api.artist(r.artist.slug);
        if (cancelled) return;
        setRelease(r);
        setArtistPage(page);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load the release."));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <ErrorNote message={error} />;
  if (!release || !artistPage) return <Loading />;
  if (!release.isOwner) return <ErrorNote message="Only the artist can edit this release." />;

  const update = async (change: Promise<ReleaseDetail>, message?: string) => {
    try {
      setRelease(await change);
      if (message) toast(message);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save that.");
    }
  };

  const ids = release.tracks.map((t) => t.id);
  const setTracks = (next: string[]) => update(api.setReleaseTracks(release.id, next));
  const move = (from: number, to: number) => {
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    void setTracks(next);
  };
  const available = artistPage.tracks.filter((t) => !ids.includes(t.id));

  const remove = async () => {
    if (!window.confirm(`Delete "${release.title}"? Its tracks stay on Trusic.`)) return;
    await api.deleteRelease(release.id);
    toast("Release deleted");
    navigate("/studio");
  };

  return (
    <>
      <p>
        <Link to="/studio">← Studio</Link>
      </p>
      <section className="collection-hero">
        <Artwork url={release.artworkUrl} title={release.title} size={200} />
        <div>
          <p className="eyebrow">Edit release</p>
          <h1>{release.title}</h1>
          <div className="row">
            <ImagePicker
              label={release.artworkUrl ? "Change artwork" : "Add artwork"}
              onPick={(file) => update(api.setReleaseArtwork(release.id, file, file.name), "Artwork updated")}
            />
            <Link to={`/release/${release.id}`} className="button button--ghost">
              View
            </Link>
            <button className="button button--ghost" onClick={() => void remove()}>
              Delete
            </button>
          </div>
          <p className="muted small">Square images work best: at least 640 × 640, PNG, JPEG or WebP.</p>
        </div>
      </section>

      <div className="grid-2">
        <DetailsForm release={release} onSave={(input) => update(api.updateRelease(release.id, input), "Saved")} />

        <div className="card">
          <h2>Tracks</h2>
          {release.tracks.length === 0 ? <p className="muted">Add tracks from the list below.</p> : null}
          <ol className="edit-list">
            {release.tracks.map((t, i) => (
              <li key={t.id}>
                <span className="edit-list__num">{i + 1}</span>
                <span className="edit-list__title">{t.title}</span>
                <AiBadge score={t.aiScore} compact />
                <span className="muted small">{duration(t.durationMs)}</span>
                <button
                  className="icon-button"
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                  aria-label={`Move ${t.title} up`}
                >
                  <Icon name="up" size={16} />
                </button>
                <button
                  className="icon-button"
                  disabled={i === ids.length - 1}
                  onClick={() => move(i, i + 1)}
                  aria-label={`Move ${t.title} down`}
                >
                  <Icon name="down" size={16} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => void setTracks(ids.filter((x) => x !== t.id))}
                  aria-label={`Take ${t.title} off this release`}
                >
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ol>

          {available.length ? (
            <>
              <h3>Add tracks</h3>
              <ul className="edit-list edit-list--available">
                {available.map((t) => (
                  <li key={t.id}>
                    <span className="edit-list__title">{t.title}</span>
                    {t.release ? <span className="muted small">on {t.release.title}</span> : null}
                    <AiBadge score={t.aiScore} compact />
                    <button
                      className="icon-button"
                      onClick={() => void setTracks([...ids, t.id])}
                      aria-label={`Add ${t.title}`}
                    >
                      <Icon name="plus" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="muted small">
            <Link to="/upload">Upload a new track</Link> and pick this release to add it straight to the end.
          </p>
        </div>
      </div>
    </>
  );
}

function DetailsForm({
  release,
  onSave,
}: {
  release: ReleaseDetail;
  onSave(input: { title: string; type: ReleaseType; releaseDate: string | null }): Promise<void>;
}) {
  const [title, setTitle] = useState(release.title);
  const [type, setType] = useState<ReleaseType>(release.type);
  const [releaseDate, setReleaseDate] = useState(release.releaseDate ?? "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSave({ title: title.trim(), type, releaseDate: releaseDate || null });
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Details</h2>
      <label>
        Title
        <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Type
        <select value={type} onChange={(e) => setType(e.target.value as ReleaseType)}>
          <option value="album">Album</option>
          <option value="ep">EP</option>
          <option value="single">Single</option>
        </select>
      </label>
      <label>
        Release date
        <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
      </label>
      <button className="button">Save details</button>
    </form>
  );
}
