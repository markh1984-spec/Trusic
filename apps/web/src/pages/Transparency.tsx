import type { PayoutRunSummary } from "@trusic/client";
import { AI_LABELS, AI_STAGES, DEFAULT_RUBRIC, type AiLabel } from "@trusic/core";
import { api } from "../api";
import { ErrorNote, Loading } from "../components/Guards";
import { money, periodName } from "../format";
import { useAsync } from "../hooks";

const LABEL_ORDER: AiLabel[] = ["human", "ai_assisted", "ai_generated"];

export function TransparencyPage() {
  const { data, error, loading } = useAsync(() => api.transparency(), []);

  return (
    <>
      <section className="hero hero--small">
        <h1>Where the money goes</h1>
        <p>
          Everything Trusic earns is split the same way, and we publish the results every month. No secret deals, no
          pay-for-play, and no stream farms paid out of your subscription.
        </p>
      </section>

      {error ? <ErrorNote message={error} /> : null}
      {loading && !data ? <Loading /> : null}

      {data ? (
        <>
          <section className="stats">
            <div className="stat">
              <span className="stat__value">{100 - data.platformSharePercent}%</span>
              <span className="stat__label">of revenue goes to artists</span>
            </div>
            <div className="stat">
              <span className="stat__value">{data.platformSharePercent}%</span>
              <span className="stat__label">runs Trusic</span>
            </div>
            {LABEL_ORDER.map((l) => (
              <div className="stat" key={l}>
                <span className={`stat__value stat__value--${l}`}>{data.catalog[l]}</span>
                <span className="stat__label">{AI_LABELS[l].name} tracks</span>
              </div>
            ))}
          </section>

          <h2>Monthly payouts</h2>
          {data.runs.length === 0 ? <p className="muted">No payouts have run yet.</p> : null}
          {data.runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </>
      ) : null}

      <section className="card">
        <h2>How payouts work</h2>
        <ol className="steps">
          <li>
            <strong>80/20.</strong> Of every pound a listener pays (after VAT and card fees), 20p runs Trusic and 80p
            goes to artists.
          </li>
          <li>
            <strong>Your money, your artists.</strong> Your 80p is shared only between the tracks <em>you</em> played
            for at least {data?.minStreamSeconds ?? 30} seconds, by how often you played them. Heavy listeners and
            stream farms can't redirect your money.
          </li>
          <li>
            <strong>Human-weighted.</strong> Each stream counts as (100 − AI score)%. A human-made track gets the full
            rate, AI score 25 gets 75%, AI score 100 gets nothing. What AI tracks give up goes to the human-made tracks
            you played.
          </li>
          <li>
            <strong>The human pot.</strong> If you only played fully AI tracks, or nothing at all, your 80p goes to a
            shared pot for human-made music, split by listening across Trusic.
          </li>
          <li>
            <strong>Band splits.</strong> Each track's money is divided between its members, by percentages they set.
          </li>
        </ol>
        <h3>Worked example</h3>
        <p className="muted">One listener pays £10,000 (to keep the numbers round) and plays three tracks:</p>
        <table className="table">
          <thead>
            <tr>
              <th>Track</th>
              <th className="num">Streams</th>
              <th className="num">AI score</th>
              <th className="num">Without AI weighting</th>
              <th className="num">Paid</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>A human band</td>
              <td className="num">5,000</td>
              <td className="num">0</td>
              <td className="num muted">£4,000</td>
              <td className="num">£5,405.41</td>
            </tr>
            <tr>
              <td>A band that used some AI</td>
              <td className="num">3,000</td>
              <td className="num">20</td>
              <td className="num muted">£2,400</td>
              <td className="num">£2,594.59</td>
            </tr>
            <tr>
              <td>A prompt-generated song</td>
              <td className="num">2,000</td>
              <td className="num">100</td>
              <td className="num muted">£1,600</td>
              <td className="num">£0.00</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>How the AI score is worked out</h2>
        <p>
          Artists declare, part by part, how much AI went into a track. Detection can raise that score but never lower
          it, and artists can appeal to a person. Only AI <em>generating</em> the music counts. AI that merely assisted
          a person (suggesting a rhyme or a chord) is shown but free, and AI mastering, mixing, stem separation and
          similar tools never affect the score.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Part of the track</th>
              <th className="num">Weight</th>
              <th className="num">AI-assisted (free)</th>
              <th className="num">AI-generated</th>
            </tr>
          </thead>
          <tbody>
            {AI_STAGES.map((s) => {
              const w = DEFAULT_RUBRIC.stages[s].weight;
              return (
                <tr key={s}>
                  <td>
                    {DEFAULT_RUBRIC.stages[s].label}
                    <div className="muted small">{DEFAULT_RUBRIC.stages[s].description}</div>
                  </td>
                  <td className="num">{w}</td>
                  <td className="num">+{(w * DEFAULT_RUBRIC.levels.assisted.percent) / 100}</td>
                  <td className="num">+{(w * DEFAULT_RUBRIC.levels.generated.percent) / 100}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">
          Parts a track doesn't have (like vocals on an instrumental) are left out and the rest scaled up, so a fully
          generated instrumental still scores 100. Labels: under 10 is {AI_LABELS.human.name}, 10–69 is{" "}
          {AI_LABELS.ai_assisted.name}, 70 and up is {AI_LABELS.ai_generated.name}.
        </p>
      </section>
    </>
  );
}

function RunCard({ run }: { run: PayoutRunSummary }) {
  const c = run.currency;
  const t = run.totals;
  const totalStreams = Math.max(1, t.streams);
  return (
    <section className="card run">
      <h3>{periodName(run.period)}</h3>
      <div className="run__totals">
        <div>
          <span className="muted small">Revenue</span>
          <strong>{money(t.revenue, c)}</strong>
        </div>
        <div>
          <span className="muted small">Trusic ({run.platformSharePercent}%)</span>
          <strong>{money(t.platform, c)}</strong>
        </div>
        <div>
          <span className="muted small">Paid to artists</span>
          <strong>{money(t.paidToArtists, c)}</strong>
        </div>
        <div>
          <span className="muted small">Moved from AI to human music</span>
          <strong className="text-human">{money(t.forfeitedByAi, c)}</strong>
        </div>
        {t.carriedForward > 0 ? (
          <div>
            <span className="muted small">Carried to next month</span>
            <strong>{money(t.carriedForward, c)}</strong>
          </div>
        ) : null}
      </div>
      <div className="split-bar" aria-label="Streams by label">
        {LABEL_ORDER.map((l) =>
          run.byLabel[l].streams ? (
            <span
              key={l}
              className={`split-bar__seg split-bar__seg--${l}`}
              style={{ width: `${(run.byLabel[l].streams / totalStreams) * 100}%` }}
              title={`${AI_LABELS[l].name}: ${run.byLabel[l].streams} streams`}
            />
          ) : null,
        )}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Label</th>
            <th className="num">Tracks</th>
            <th className="num">Streams</th>
            <th className="num">Share of streams</th>
            <th className="num">Paid</th>
            <th className="num">Gave up</th>
          </tr>
        </thead>
        <tbody>
          {LABEL_ORDER.map((l) => {
            const b = run.byLabel[l];
            return (
              <tr key={l}>
                <td>
                  <span className={`dot dot--${l}`} /> {AI_LABELS[l].name}
                </td>
                <td className="num">{b.tracks}</td>
                <td className="num">{b.streams.toLocaleString("en-GB")}</td>
                <td className="num">{Math.round((b.streams / totalStreams) * 100)}%</td>
                <td className="num">{money(b.amount, c)}</td>
                <td className="num muted">{b.forfeited ? money(b.forfeited, c) : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
