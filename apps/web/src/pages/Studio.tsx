import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { AiBadge } from "../components/AiBadge";
import { ErrorNote, Loading, RequireAuth } from "../components/Guards";
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
      <Earnings />
      {artists.map((a) => (
        <ArtistTracks key={a.id} slug={a.slug} name={a.name} />
      ))}
      <NewArtist />
    </>
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

function ArtistTracks({ slug, name }: { slug: string; name: string }) {
  const { data, error, loading } = useAsync(() => api.artist(slug), [slug]);
  return (
    <section className="card">
      <div className="section-head">
        <h2>{name}</h2>
        <Link to={`/artist/${slug}`}>Public page →</Link>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data?.tracks.length === 0 ? <p className="muted">No tracks yet.</p> : null}
      {data?.tracks.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Track</th>
              <th>Label</th>
              <th className="num">Pay rate</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.tracks.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link to={`/track/${t.id}`}>{t.title}</Link>
                </td>
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
      {data ? <p className="muted small">{plural(data.tracks.length, "track")} live</p> : null}
    </section>
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
