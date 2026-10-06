import type { ReleaseType } from "@trusic/client";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { AiBadge } from "../components/AiBadge";
import { Artwork } from "../components/Artwork";
import { CardGrid, TYPE_NAMES } from "../components/Cards";
import { ErrorNote, Loading, RequireAuth } from "../components/Guards";
import { Icon } from "../components/Icon";
import { ImagePicker } from "../components/ImagePicker";
import { money, periodName, plural } from "../format";
import { useAsync } from "../hooks";

export function StudioPage() {
  return (
    <RequireAuth>
      <Studio />
    </RequireAuth>
  );
}

function Studio() {
  const { me } = useAuth();
  const artists = me!.artists;

  return (
    <>
      <div className="section-head">
        <h1>Studio</h1>
        <Link to="/upload" className="button">
          Upload a track
        </Link>
      </div>
      <BalanceCard />
      <Earnings />
      {artists.map((a) => (
        <ArtistSection key={a.id} slug={a.slug} />
      ))}
      <NewArtist />
    </>
  );
}

const ENTRY_NAMES = {
  earnings: "Earnings",
  clawback: "Clawback",
  payout: "Paid out",
  adjustment: "Adjustment",
} as const;

/** What the artist is owed, what's been clawed back, and any strikes. */
function BalanceCard() {
  const { data, error } = useAsync(() => api.balance(), []);
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  return (
    <section className="card">
      {data.suspended ? (
        <p className="note note--error">
          Your account is suspended after three false AI declarations. Your tracks are hidden and you can't upload.
          Contact Trusic to appeal.
        </p>
      ) : null}
      <div className="balance">
        <div>
          <span className="muted small">Available to pay out</span>
          <strong className={data.available < 0 ? "text-danger" : ""}>{money(data.available, data.currency)}</strong>
        </div>
        <div>
          <span className="muted small">Pending (month not finalised)</span>
          <strong>{money(data.pending, data.currency)}</strong>
        </div>
      </div>
      {data.strikes.length ? (
        <>
          <h3>Strikes ({data.strikes.length} of 3)</h3>
          <ul className="plain-list">
            {data.strikes.map((s) => (
              <li key={s.id}>
                <span>
                  <strong>{s.trackTitle}</strong>: declared AI {s.declaredScore}, corrected to {s.correctedScore}.{" "}
                  <span className="muted">{s.reason}</span>
                </span>
                {s.clawbackTotal ? (
                  <strong className="text-danger">−{money(s.clawbackTotal, data.currency)}</strong>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {data.entries.length ? (
        <details>
          <summary className="small">History</summary>
          <table className="table">
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{new Date(e.createdAt).toLocaleDateString("en-GB")}</td>
                  <td>
                    {ENTRY_NAMES[e.type]}
                    {e.pending ? <span className="muted small"> (pending)</span> : null}
                  </td>
                  <td className="small">{e.note}</td>
                  <td className={`num ${e.amount < 0 ? "text-danger" : ""}`}>{money(e.amount, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </section>
  );
}

function Earnings() {
  const { data, error, loading } = useAsync(() => api.earnings(), []);
  if (error) return <ErrorNote message={error} />;
  if (loading || !data) return <Loading />;

  return (
    <section className="card">
      <h2>Earnings</h2>
      {data.length === 0 ? (
        <p className="muted">No payouts yet. Earnings appear here after each monthly payout run.</p>
      ) : (
        data.map((period) => (
          <div key={period.period} className="earnings-period">
            <div className="earnings-period__head">
              <h3>{periodName(period.period)}</h3>
              <span className="big-number">{money(period.amount, period.currency)}</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Track</th>
                  <th>AI</th>
                  <th className="num">Streams</th>
                  <th className="num">Without AI weighting</th>
                  <th className="num">Track earned</th>
                  <th className="num">Your share</th>
                </tr>
              </thead>
              <tbody>
                {period.tracks.map((t) => (
                  <tr key={t.track.id}>
                    <td>
                      <Link to={`/track/${t.track.id}`}>{t.track.title}</Link>
                    </td>
                    <td>
                      <AiBadge score={t.track.aiScore} compact />
                    </td>
                    <td className="num">{t.streams.toLocaleString("en-GB")}</td>
                    <td className="num muted">{money(t.baseAmount, period.currency)}</td>
                    <td className="num">
                      {money(t.trackAmount, period.currency)}
                      {t.uplift > 0 ? (
                        <span className="delta delta--up"> +{money(t.uplift, period.currency)}</span>
                      ) : null}
                      {t.forfeited > 0 ? (
                        <span className="delta delta--down"> −{money(t.forfeited, period.currency)}</span>
                      ) : null}
                    </td>
                    <td className="num">
                      <strong>{money(t.amount, period.currency)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              <span className="delta delta--up">Green</span> is extra money from AI tracks' forfeits.{" "}
              <span className="delta delta--down">Red</span> is what a track gave up because of its AI score.
            </p>
          </div>
        ))
      )}
    </section>
  );
}

function ArtistSection({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useAsync(() => api.artist(slug), [slug]);
  const { refresh } = useAuth();
  if (error) return <ErrorNote message={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { artist, tracks, releases } = data;

  return (
    <section className="card">
      <div className="studio-artist">
        <Artwork url={artist.imageUrl} title={artist.name} size={72} round />
        <div className="studio-artist__name">
          <h2>{artist.name}</h2>
          <Link to={`/artist/${slug}`}>Public page →</Link>
        </div>
        <ImagePicker
          label={artist.imageUrl ? "Change photo" : "Add photo"}
          onPick={async (file) => {
            await api.setArtistImage(artist.id, file, file.name);
            reload();
            await refresh();
          }}
        />
      </div>

      <h3>Releases</h3>
      <CardGrid>
        {releases.map((r) => (
          <Link key={r.id} to={`/studio/release/${r.id}`} className="tile">
            <Artwork url={r.artworkUrl} title={r.title} size="fill" />
            <span className="tile__title">{r.title}</span>
            <span className="tile__sub">
              {TYPE_NAMES[r.type]} · {plural(r.trackCount, "track")}
            </span>
          </Link>
        ))}
        <NewRelease artistId={artist.id} />
      </CardGrid>

      <h3>Tracks</h3>
      {tracks.length === 0 ? <p className="muted">No tracks yet.</p> : null}
      {tracks.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Track</th>
              <th>Release</th>
              <th>Label</th>
              <th className="num">Pay rate</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link to={`/track/${t.id}`}>{t.title}</Link>
                </td>
                <td className="muted">{t.release?.title ?? "–"}</td>
                <td>
                  <AiBadge score={t.aiScore} />
                </td>
                <td className="num">{t.payoutRatePercent}%</td>
                <td>
                  {t.flagged ? (
                    <Link to={`/track/${t.id}`} className="status status--warn">
                      Flagged by detection: review it
                    </Link>
                  ) : t.scoreSource === "review" ? (
                    <span className="status">Reviewed</span>
                  ) : (
                    <span className="status status--ok">Live</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="muted small">{plural(tracks.length, "track")} live</p>
    </section>
  );
}

/** A tile that turns into a small form for starting a new release. */
function NewRelease({ artistId }: { artistId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ReleaseType>("album");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="tile tile--new" onClick={() => setOpen(true)}>
        <span className="tile__plus" aria-hidden>
          <Icon name="plus" size={36} />
        </span>
        <span className="tile__title">New release</span>
        <span className="tile__sub">Album, EP or single</span>
      </button>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const release = await api.createRelease({ artistId, title: title.trim(), type });
      navigate(`/studio/release/${release.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the release.");
    }
  };

  return (
    <form className="tile tile--form form" onSubmit={submit}>
      <label>
        Title
        <input autoFocus required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Type
        <select value={type} onChange={(e) => setType(e.target.value as ReleaseType)}>
          <option value="album">Album</option>
          <option value="ep">EP</option>
          <option value="single">Single</option>
        </select>
      </label>
      {error ? <span className="field-error">{error}</span> : null}
      <div className="row">
        <button className="button">Create</button>
        <button type="button" className="button button--ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function NewArtist() {
  const { refresh } = useAuth();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createArtist({ name: name.trim(), bio: bio.trim() });
      setName("");
      setBio("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the profile.");
    }
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h2>New artist profile</h2>
      <p className="muted small">One account can run several profiles: your band, a side project, a solo name.</p>
      {error ? <ErrorNote message={error} /> : null}
      <label>
        Name
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Bio
        <textarea rows={2} maxLength={2000} value={bio} onChange={(e) => setBio(e.target.value)} />
      </label>
      <button className="button button--ghost">Create profile</button>
    </form>
  );
}
