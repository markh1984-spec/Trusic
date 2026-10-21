import { AI_LABELS, type AiLabel } from "@trusic/core";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, Loading } from "../components/Guards";
import { HomeShelfView } from "../components/Shelves";
import { TrackList } from "../components/TrackList";
import { useAsync } from "../hooks";
import { useHumanOnly } from "../human-only";

const FILTERS: { value: AiLabel | ""; label: string }[] = [
  { value: "", label: "Everything" },
  { value: "human", label: AI_LABELS.human.name },
  { value: "ai_assisted", label: AI_LABELS.ai_assisted.name },
  { value: "ai_generated", label: AI_LABELS.ai_generated.name },
];

function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export function HomePage() {
  const { me } = useAuth();
  const { humanOnly, setHumanOnly } = useHumanOnly();
  const [label, setLabel] = useState<AiLabel | "">("");
  const feed = useAsync(() => api.home({ humanOnly }), [humanOnly, me?.user.id]);
  const { data, error, loading } = useAsync(
    () => api.tracks({ label: humanOnly ? "" : label, limit: 100, humanOnly }),
    [label, humanOnly],
  );

  return (
    <>
      {me ? (
        <section className="home-greeting">
          <h1>
            {greeting()}, {me.user.displayName.split(" ")[0]}
          </h1>
        </section>
      ) : (
        <>
          <section className="hero">
            <h1>Music made by people, paid like it.</h1>
            <p>
              Every track on Trusic shows how much AI went into it. Artists get 80% of every pound, and each listener's
              money goes only to the music that listener played. AI-generated tracks earn less, or nothing, and what
              they give up goes to human musicians.
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
        </>
      )}

      {humanOnly ? (
        <p className="note note--ok home-note">
          <strong>{AI_LABELS.human.name} only is on.</strong> Tracks labelled {AI_LABELS.ai_assisted.name} and{" "}
          {AI_LABELS.ai_generated.name} are left out of these shelves, search and radio.{" "}
          <button className="link-button" onClick={() => void setHumanOnly(false)}>
            Show everything
          </button>
        </p>
      ) : null}
      {me && feed.data && !feed.data.personalised ? (
        <p className="note home-note">
          Play a few tracks, like the ones you love or follow an artist, and this page will fill up with music picked
          for you. Until then, here's what people are playing on Trusic.
        </p>
      ) : null}

      {feed.error ? <ErrorNote message={feed.error} /> : null}
      {feed.loading && !feed.data ? <Loading /> : null}
      <div className={`shelves${feed.loading && feed.data ? " is-refreshing" : ""}`}>
        {feed.data?.shelves.map((shelf) => (
          <HomeShelfView key={shelf.id} shelf={shelf} />
        ))}
      </div>

      <section>
        <div className="section-head">
          <h2>Browse new tracks</h2>
          {humanOnly ? null : (
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
          )}
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
