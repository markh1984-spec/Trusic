import type { StudioArtist } from "@trusic/client";
import { Link } from "react-router";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Artwork } from "./Artwork";
import { compact } from "./Charts";
import { Icon } from "./Icon";

/** The last 28 days for one artist, linking to its full stats. */
function Summary({ item }: { item: StudioArtist }) {
  const { data } = useAsync(() => api.artistStats(item.artist.id, "28d"), [item.artist.id]);
  const max = Math.max(1, ...(data?.series.map((p) => p.streams) ?? []));
  return (
    <Link to={`/studio/artist/${item.artist.id}`} className="studio-stats__item">
      <Artwork url={item.artist.imageUrl} title={item.artist.name} size={48} round />
      <span className="studio-stats__name">
        <strong>{item.artist.name}</strong>
        <span className="muted small">{item.role === "owner" ? "Your profile" : "You're in the band's splits"}</span>
      </span>
      {data ? (
        <>
          <span className="studio-stats__figure">
            <strong>{compact(data.totals.streams)}</strong>
            <span className="muted small">streams</span>
          </span>
          <span className="studio-stats__figure">
            <strong>{compact(data.totals.listeners)}</strong>
            <span className="muted small">listeners</span>
          </span>
          <span className="studio-stats__figure">
            <strong>{compact(data.followers)}</strong>
            <span className="muted small">followers</span>
          </span>
          {/* A tiny picture of the 28 days; the numbers are on the stats page. */}
          <span className="studio-stats__spark" aria-hidden>
            {data.series.map((p) => (
              <span key={p.start} style={{ height: `${Math.max(4, (p.streams / max) * 100)}%` }} />
            ))}
          </span>
        </>
      ) : (
        <span className="muted small">Loading…</span>
      )}
      <span className="studio-stats__open">
        Stats <Icon name="chart" size={16} />
      </span>
    </Link>
  );
}

/** "Trusic for Artists" in Studio: every artist the user owns or plays in, with the last 28 days at a glance. */
export function StudioStats() {
  const { data } = useAsync(() => api.studioArtists(), []);
  if (!data?.length) return null;
  return (
    <section className="card studio-stats">
      <h2>Trusic for Artists</h2>
      <p className="muted small">Your listeners over the last 28 days. Open an artist for charts, sources and money.</p>
      {data.map((item) => (
        <Summary key={item.artist.id} item={item} />
      ))}
    </section>
  );
}
