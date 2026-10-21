import { AI_LABELS } from "@trusic/core";
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

/** The same stats as the artist page, for one track. */
export function TrackStatsPage() {
  return (
    <RequireAuth>
      <TrackStats />
    </RequireAuth>
  );
}

function TrackStats() {
  const { id = "" } = useParams();
  const [range, setRange] = useRange();
  const { data: stats, error, loading } = useAsync(() => api.trackStats(id, range), [id, range]);

  if (error) return <ErrorNote message={error} />;
  if (!stats) return <Loading />;
  const { track, totals, previous } = stats;

  return (
    <div className={`stats-page${loading ? " is-refreshing" : ""}`}>
      <p className="eyebrow">
        <Link to="/studio">Studio</Link> · <Link to={`/studio/artist/${track.artist.id}`}>{track.artist.name}</Link> ·
        Track stats
      </p>
      <div className="section-head">
        <div className="stats-title">
          <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size={56} />
          <div>
            <h1>{track.title}</h1>
            <p className="muted small">
              <AiBadge score={track.aiScore} /> Earns {track.payoutRatePercent}% of the human rate per stream ·{" "}
              <Link to={`/track/${track.id}`}>Public page</Link>
            </p>
          </div>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>
      <p className="muted small">{ROLE_NOTES[stats.role]}</p>

      <section className="stats stats--tiles">
        <StatTile label="Streams" value={totals.streams} previous={previous.streams} range={range} />
        <StatTile label="Listeners" value={totals.listeners} previous={previous.listeners} range={range} />
        <StatTile
          label="New likes"
          value={totals.likes}
          previous={previous.likes}
          range={range}
          note={`${stats.likesTotal.toLocaleString("en-GB")} in all`}
        />
        <StatTile
          label="Short plays"
          value={totals.shortPlays}
          range={range}
          note="Stopped before 30 seconds, so not streams"
        />
      </section>
      {track.aiLabel !== "human" ? (
        <p className="note small">
          This track is labelled {AI_LABELS[track.aiLabel].name}, so each stream earns {track.payoutRatePercent}% of
          what a {AI_LABELS.human.name} track earns. Its streams still count in full here.
        </p>
      ) : null}

      <ListeningChart stats={stats} withFollowers={false} />
      <SourcesCard sources={stats.sources} />
      <MoneyCard data={stats.money} single />
    </div>
  );
}
