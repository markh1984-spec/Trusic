import { AI_LABELS, type AiLabel } from "@trusic/core";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { CardGrid, ReleaseCard } from "../components/Cards";
import { ErrorNote, Loading } from "../components/Guards";
import { TrackList } from "../components/TrackList";
import { useAsync } from "../hooks";

const FILTERS: { value: AiLabel | ""; label: string }[] = [
  { value: "", label: "Everything" },
  { value: "human", label: AI_LABELS.human.name },
  { value: "ai_assisted", label: AI_LABELS.ai_assisted.name },
  { value: "ai_generated", label: AI_LABELS.ai_generated.name },
];

export function HomePage() {
  const [label, setLabel] = useState<AiLabel | "">("");
  const { data, error, loading } = useAsync(() => api.tracks({ label, limit: 100 }), [label]);
  const releases = useAsync(() => api.newReleases(), []);

  return (
    <>
      <section className="hero">
        <h1>Music made by people, paid like it.</h1>
        <p>
          Every track on Trusic shows how much AI went into it. Artists get 80% of every pound, and each listener's
          money goes only to the music that listener played. AI-generated tracks earn less, or nothing, and what they
          give up goes to human musicians.
        </p>
        <div className="hero__actions">
          <Link to="/transparency" className="button">
            See where the money goes
          </Link>
          <Link to="/upload" className="button button--ghost">
            Upload your music
          </Link>
        </div>
      </section>

      <section className="explainer">
        <div className="explainer__card">
          <span className="explainer__big">80 / 20</span>
          <p>80% of revenue to artists, 20% to run Trusic. No hidden deals.</p>
        </div>
        <div className="explainer__card">
          <span className="explainer__big">Your £, your artists</span>
          <p>Your subscription is split only between the tracks you listened to.</p>
        </div>
        <div className="explainer__card">
          <span className="explainer__big">AI score 0–100</span>
          <p>A track with AI score 25 earns 75% of the human rate. A score of 100 earns nothing.</p>
        </div>
      </section>

      {releases.data?.length ? (
        <section>
          <h2>New releases</h2>
          <CardGrid>
            {releases.data.map((r) => (
              <ReleaseCard key={r.id} release={r} showArtist />
            ))}
          </CardGrid>
        </section>
      ) : null}

      <section>
        <div className="section-head">
          <h2>New tracks</h2>
          <div className="chips" role="radiogroup" aria-label="Filter by AI label">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                role="radio"
                aria-checked={label === f.value}
                className={`chip${label === f.value ? " chip--active" : ""}`}
                onClick={() => setLabel(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {error ? (
          <ErrorNote message={error} />
        ) : loading && !data ? (
          <Loading />
        ) : (
          <TrackList tracks={data?.tracks ?? []} label="New tracks" />
        )}
      </section>
    </>
  );
}
