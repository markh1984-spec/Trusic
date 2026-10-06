import type { AdminAppeal, PayoutRunSummary } from "@trusic/client";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { AiBadge } from "../components/AiBadge";
import { ErrorNote, Loading, RequireAuth } from "../components/Guards";
import { money, periodName } from "../format";
import { useAsync } from "../hooks";

export function AdminPage() {
  return (
    <RequireAuth admin>
      <h1>Admin</h1>
      <Payouts />
      <Appeals />
    </RequireAuth>
  );
}

function Payouts() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [result, setResult] = useState<PayoutRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.runPayouts(period));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payout run failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Monthly payouts</h2>
      <p className="muted small">
        Calculates the month from plays and revenue, and publishes it to statements, earnings and the transparency page.
        Running a month again replaces its results.
      </p>
      <form className="row" onSubmit={run}>
        <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} required aria-label="Month" />
        <button className="button" disabled={busy}>
          {busy ? "Running…" : "Run payouts"}
        </button>
      </form>
      {error ? <ErrorNote message={error} /> : null}
      {result ? (
        <p className="note note--ok">
          {periodName(result.period)}: {money(result.totals.revenue, result.currency)} in,{" "}
          {money(result.totals.paidToArtists, result.currency)} to artists,{" "}
          {money(result.totals.forfeitedByAi, result.currency)} moved from AI to human music.{" "}
          <Link to="/transparency">View →</Link>
        </p>
      ) : null}
    </section>
  );
}

function Appeals() {
  const { data, error, loading, reload } = useAsync(() => api.adminAppeals("open"), []);

  return (
    <section className="card">
      <h2>Score appeals</h2>
      {error ? <ErrorNote message={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data?.length === 0 ? <p className="muted">No open appeals.</p> : null}
      {data?.map((a) => (
        <AppealItem key={a.id} appeal={a} onDone={reload} />
      ))}
    </section>
  );
}

function AppealItem({ appeal, onDone }: { appeal: AdminAppeal; onDone(): void }) {
  const [score, setScore] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const t = appeal.track;

  const resolve = async (decision: "upheld" | "rejected") => {
    setError(null);
    try {
      await api.resolveAppeal(appeal.id, {
        decision,
        ...(score !== "" ? { score: Number(score) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't resolve the appeal.");
    }
  };

  return (
    <article className="appeal">
      <div className="appeal__head">
        <Link to={`/track/${t.id}`}>
          <strong>{t.title}</strong>
        </Link>
        <span className="muted">by {t.artist.name}</span>
        <AiBadge score={t.aiScore} />
      </div>
      <p className="small">
        Declared <strong>{t.declaredScore}</strong>, now <strong>{t.aiScore}</strong> ({t.scoreSource}).
        {t.detection ? ` Detection: ${t.detection.verdict} (${Math.round(t.detection.confidence * 100)}%).` : ""}
      </p>
      {t.detection?.evidence.length ? (
        <ul className="small muted">
          {t.detection.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <blockquote>{appeal.message}</blockquote>
      <p className="muted small">
        From {appeal.openedBy.displayName} ({appeal.openedBy.email})
      </p>
      {error ? <ErrorNote message={error} /> : null}
      <div className="row">
        <input
          type="number"
          min={0}
          max={100}
          placeholder="Score (optional)"
          value={score}
          onChange={(e) => setScore(e.target.value)}
          aria-label="Score"
        />
        <input
          placeholder="Note to the artist (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Note"
        />
        <button className="button" onClick={() => void resolve("upheld")}>
          Uphold
        </button>
        <button className="button button--ghost" onClick={() => void resolve("rejected")}>
          Reject
        </button>
      </div>
      <p className="muted small">
        Uphold resets the score to what the artist declared; reject keeps the current score. A score you enter replaces
        either.
      </p>
    </article>
  );
}
