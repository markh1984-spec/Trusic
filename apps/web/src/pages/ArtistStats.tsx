import { Link, useParams } from "react-router";
import { api } from "../api";
import { AiBadge } from "../components/AiBadge";
import { Artwork } from "../components/Artwork";
import { ErrorNote, Loading, RequireAuth } from "../components/Guards";
import {
  ListeningChart,
  MoneyCard,
  RangePicker,
  ROLE_NOTES,
  SourcesCard,
  StatTile,
  useRange,
} from "../components/StatsParts";
import { useAsync } from "../hooks";

/** "Trusic for Artists": one artist's listening and the viewer's own money from it. */
export function ArtistStatsPage() {
  return (
    <RequireAuth>
      <ArtistStats />
    </RequireAuth>
  );
}

function ArtistStats() {
  const { id = "" } = useParams();
  const [range, setRange] = useRange();
  const { data: stats, error, loading } = useAsync(() => api.artistStats(id, range), [id, range]);
  const moneyData = useAsync(() => api.artistMoney(id), [id]);

  if (error) return <ErrorNote message={error} />;
  if (!stats) return <Loading />;
  const { totals, previous } = stats;
  const topStreams = Math.max(1, ...stats.topTracks.map((t) => t.streams));

  return (
    <div className={`stats-page${loading ? " is-refreshing" : ""}`}>
      <p className="eyebrow">
        <Link to="/studio">Studio</Link> · Trusic for Artists
      </p>
      <div className="section-head">
        <h1>{stats.artist.name}</h1>
        <RangePicker value={range} onChange={setRange} />
      </div>
      <p className="muted small">{ROLE_NOTES[stats.role]}</p>

      <section className="stats stats--tiles">
        <StatTile label="Streams" value={totals.streams} previous={previous.streams} range={range} />
        <StatTile label="Listeners" value={totals.listeners} previous={previous.listeners} range={range} />
        <StatTile
          label="Followers"
          value={stats.followers}
          range={range}
          note={`${stats.followersGained.toLocaleString("en-GB")} followed in this time`}
        />
        <StatTile label="New likes" value={totals.likes} previous={previous.likes} range={range} />
      </section>
      {totals.shortPlays ? (
        <p className="muted small">
          {totals.shortPlays.toLocaleString("en-GB")} more {totals.shortPlays === 1 ? "play" : "plays"} stopped before
          30 seconds, so {totals.shortPlays === 1 ? "it doesn't" : "they don't"} count as streams.
        </p>
      ) : null}

      <ListeningChart stats={stats} withFollowers />

      <div className="grid-2">
        <section className="card">
          <h2>Top tracks</h2>
          {stats.topTracks.length === 0 ? (
            <p className="muted">No streams in this time yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Track</th>
                  <th>Label</th>
                  <th className="num">Streams</th>
                  <th className="num">Listeners</th>
                </tr>
              </thead>
              <tbody>
                {stats.topTracks.map(({ track, streams, listeners }) => (
                  <tr key={track.id}>
                    <td>
                      <Link
                        to={`/studio/track/${track.id}${range === "28d" ? "" : `?range=${range}`}`}
                        className="top-track"
                      >
                        <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={32} />
                        <span>
                          {track.title}
                          <span className="top-track__bar" aria-hidden>
                            <span style={{ width: `${(streams / topStreams) * 100}%` }} />
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <AiBadge score={track.aiScore} compact />
                    </td>
                    <td className="num">{streams.toLocaleString("en-GB")}</td>
                    <td className="num">{listeners.toLocaleString("en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <SourcesCard sources={stats.sources} />
      </div>

      {moneyData.error ? <ErrorNote message={moneyData.error} /> : null}
      {moneyData.data ? <MoneyCard data={moneyData.data} /> : null}
    </div>
  );
}
