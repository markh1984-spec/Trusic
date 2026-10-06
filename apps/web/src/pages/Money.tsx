import type { ListenerStatementView } from "@trusic/client";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { AiBadge } from "../components/AiBadge";
import { ErrorNote, Loading, RequireAuth } from "../components/Guards";
import { money, periodName } from "../format";
import { useAsync } from "../hooks";

export function MoneyPage() {
  return (
    <RequireAuth>
      <Money />
    </RequireAuth>
  );
}

function Money() {
  const { me, refresh } = useAuth();
  const { data, error, loading } = useAsync(() => api.statements(), []);
  const [busy, setBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const premium = me!.user.plan === "premium";

  const changePlan = async () => {
    setBusy(true);
    setPlanError(null);
    try {
      if (premium) await api.cancelSubscription();
      else await api.subscribe();
      await refresh();
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Couldn't change your plan.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Your money</h1>
      <section className="card plan">
        <div>
          <h2>{premium ? "You're on Premium" : "You're on the free plan"}</h2>
          <p className="muted">
            {premium
              ? "Your subscription is split between the tracks you play, weighted towards human-made music."
              : "Go Premium and your money goes straight to the artists you actually listen to."}
          </p>
          <p className="muted small">Demo billing: no card needed. Real payments come later.</p>
        </div>
        <button className={premium ? "button button--ghost" : "button"} onClick={changePlan} disabled={busy}>
          {premium ? "Cancel Premium" : "Go Premium"}
        </button>
        {planError ? <ErrorNote message={planError} /> : null}
      </section>

      <h2>Where your money went</h2>
      {error ? <ErrorNote message={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data?.length === 0 ? (
        <p className="muted">
          Statements appear after each monthly payout. <Link to="/transparency">How payouts work →</Link>
        </p>
      ) : null}
      {data?.map((s) => (
        <Statement key={s.period} statement={s} />
      ))}
    </>
  );
}

function Statement({ statement: s }: { statement: ListenerStatementView }) {
  const max = Math.max(1, ...s.allocations.map((a) => Math.max(a.amount, a.baseAmount)));
  return (
    <section className="card statement">
      <div className="statement__head">
        <h3>{periodName(s.period)}</h3>
        <div className="flow">
          <span>
            You paid <strong>{money(s.revenue, s.currency)}</strong>
          </span>
          <span className="flow__arrow">→</span>
          <span>
            Trusic <strong>{money(s.platform, s.currency)}</strong>
          </span>
          <span className="flow__plus">+</span>
          <span>
            Artists <strong>{money(s.artistShare, s.currency)}</strong>
          </span>
        </div>
      </div>

      {s.toHumanPot ? (
        <p className="note">
          {s.toHumanPot.reason === "no_streams"
            ? "You didn't play anything this month, so"
            : "Everything you played was fully AI-generated, so"}{" "}
          your {money(s.toHumanPot.amount, s.currency)} went to the shared pot for human-made music, split by listening
          across Trusic.
        </p>
      ) : null}

      <ul className="allocations">
        {s.allocations.map((a) => (
          <li key={a.track.id}>
            <div className="allocations__who">
              <Link to={`/track/${a.track.id}`}>{a.track.title}</Link>
              <span className="muted"> · {a.track.artist.name}</span>
              <AiBadge score={a.track.aiScore} compact />
            </div>
            <div className="allocations__bar" title={`Without AI weighting: ${money(a.baseAmount, s.currency)}`}>
              <span className="allocations__base" style={{ width: `${(a.baseAmount / max) * 100}%` }} />
              <span
                className={`allocations__fill allocations__fill--${a.track.aiLabel}`}
                style={{ width: `${(a.amount / max) * 100}%` }}
              />
            </div>
            <div className="allocations__amount">
              <strong>{money(a.amount, s.currency)}</strong>
              <span className="muted small">{a.streams} streams</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">The faint bar shows what each track would have got if AI scores didn't count.</p>
    </section>
  );
}
