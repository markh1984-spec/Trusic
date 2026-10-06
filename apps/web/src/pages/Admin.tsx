import type { AdminAppeal } from "@trusic/client";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { AiBadge } from "../components/AiBadge";
import { ErrorNote, Loading, RequireAuth } from "../components/Guards";
import { money, periodName } from "../format";
import { useAsync } from "../hooks";
import { useToast } from "../toast";

export function AdminPage() {
  return (
    <RequireAuth admin>
      <h1>Admin</h1>
      <Payouts />
      <Appeals />
      <Strikes />
      <Rights />
    </RequireAuth>
  );
}

function Payouts() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payResult, setPayResult] = useState<string | null>(null);
  const runs = useAsync(() => api.transparency().then((t) => t.runs), []);
  const toast = useToast();

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      toast(done);
      runs.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const run = (e: FormEvent) => {
    e.preventDefault();
    void act(() => api.runPayouts(period), `Calculated ${periodName(period)}`);
  };

  return (
    <section className="card">
      <h2>Monthly payouts</h2>
      <p className="muted small">
        Calculate a month from plays and revenue, check it, then finalise it. Until it's finalised a month can be
        recalculated (strikes recalculate it automatically). Once finalised it's locked for paying out, and later
        corrections are made by clawing money back.
      </p>
      <form className="row" onSubmit={run}>
        <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} required aria-label="Month" />
        <button className="button" disabled={busy}>
          {busy ? "Working…" : "Calculate"}
        </button>
        <button
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const r = await api.payArtists();
              const total = r.paid.reduce((acc, p) => acc + p.amount, 0);
              setPayResult(
                `Paid ${r.paid.length} artist${r.paid.length === 1 ? "" : "s"} ${money(total, r.currency)}.` +
                  (r.skipped.length
                    ? ` Skipped ${r.skipped.length}: ${r.skipped.map((s) => `${s.displayName} (${s.reason})`).join("; ")}`
                    : ""),
              );
            }, "Payout run complete")
          }
        >
          Pay artists
        </button>
      </form>
      {payResult ? <p className="note note--ok small">{payResult}</p> : null}
      {error ? <ErrorNote message={error} /> : null}
      {runs.data?.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Revenue</th>
              <th className="num">To artists</th>
              <th className="num">AI → human</th>
              <th className="num">Clawbacks in</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.data.map((r) => (
              <tr key={r.id}>
                <td>{periodName(r.period)}</td>
                <td className="num">{money(r.totals.revenue, r.currency)}</td>
                <td className="num">{money(r.totals.paidToArtists, r.currency)}</td>
                <td className="num">{money(r.totals.forfeitedByAi, r.currency)}</td>
                <td className="num">{r.totals.clawbacksIn ? money(r.totals.clawbacksIn, r.currency) : "–"}</td>
                <td>
                  {r.finalizedAt ? (
                    <span className="status status--ok">Finalised</span>
                  ) : (
                    <button
                      className="button button--ghost button--small"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Finalise ${periodName(r.period)}? It can't be recalculated afterwards.`)) {
                          return;
                        }
                        void act(() => api.finalizePayouts(r.period), `Finalised ${periodName(r.period)}`);
                      }}
                    >
                      Finalise
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

  const resolve = async (decision: "upheld" | "rejected", strike = false) => {
    setError(null);
    if (strike && !window.confirm("Issue a strike? The track's past earnings will be clawed back.")) return;
    try {
      await api.resolveAppeal(appeal.id, {
        decision,
        strike,
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
        <button className="button button--danger" onClick={() => void resolve("rejected", true)}>
          Reject + strike
        </button>
      </div>
      <p className="muted small">
        Uphold resets the score to what the artist declared; reject keeps the current score. A score you enter replaces
        either. <strong>Reject + strike</strong> is for a false declaration: the artist gets a strike, the track's
        over-earnings in finalised months are clawed back, and three strikes suspends the account.
      </p>
    </article>
  );
}

function Strikes() {
  const strikes = useAsync(() => api.adminStrikes(), []);
  const suspended = useAsync(() => api.suspendedAccounts(), []);
  const toast = useToast();

  return (
    <section className="card">
      <h2>Strikes</h2>
      {strikes.error ? <ErrorNote message={strikes.error} /> : null}
      {strikes.data?.length === 0 ? <p className="muted">No strikes yet.</p> : null}
      {strikes.data?.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Track</th>
              <th>Artist</th>
              <th className="num">Declared → corrected</th>
              <th className="num">Clawed back</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {strikes.data.map(({ strike: s, artist }) => (
              <tr key={s.id}>
                <td className="muted">{new Date(s.createdAt).toLocaleDateString("en-GB")}</td>
                <td>
                  <Link to={`/track/${s.trackId}`}>{s.trackTitle}</Link>
                </td>
                <td>
                  <Link to={`/artist/${artist.slug}`}>{artist.name}</Link>
                </td>
                <td className="num">
                  {s.declaredScore} → {s.correctedScore}
                </td>
                <td className="num">{s.clawbackTotal ? money(s.clawbackTotal) : "–"}</td>
                <td className="small">{s.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h3>Suspended accounts</h3>
      {suspended.data?.length === 0 ? <p className="muted small">None.</p> : null}
      {suspended.data?.map((u) => (
        <div key={u.id} className="row suspended-row">
          <span>
            <strong>{u.displayName}</strong> <span className="muted">{u.email}</span>
          </span>
          <span className="muted small">
            {u.strikes} strikes · suspended {new Date(u.suspendedAt).toLocaleDateString("en-GB")}
          </span>
          <button
            className="button button--ghost button--small"
            onClick={async () => {
              await api.reinstate(u.id);
              toast(`Reinstated ${u.displayName}`);
              suspended.reload();
            }}
          >
            Reinstate
          </button>
        </div>
      ))}
    </section>
  );
}

/** How much of the catalogue involves collecting-society songwriters: the key number for a PRS licence. */
function Rights() {
  const { data, error } = useAsync(() => api.rightsSummary(), []);
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const pct = (n: number) => (data.totalTracks ? `${Math.round((n / data.totalTracks) * 100)}%` : "–");
  return (
    <section className="card">
      <h2>Songwriting rights</h2>
      <p className="muted small">
        Songs by PRS (or other society) members, and covers, need a licence from PRS for Music. These numbers are what
        PRS will ask about.
      </p>
      <table className="table">
        <tbody>
          <tr>
            <td>Live tracks</td>
            <td className="num">{data.totalTracks}</td>
            <td />
          </tr>
          <tr>
            <td>A songwriter is a society member</td>
            <td className="num">{data.societyMember.yes}</td>
            <td className="num muted">{pct(data.societyMember.yes)}</td>
          </tr>
          <tr>
            <td>No society members</td>
            <td className="num">{data.societyMember.no}</td>
            <td className="num muted">{pct(data.societyMember.no)}</td>
          </tr>
          <tr>
            <td>Not sure, or not given</td>
            <td className="num">{data.societyMember.unsure + data.societyMember.notGiven}</td>
            <td className="num muted">{pct(data.societyMember.unsure + data.societyMember.notGiven)}</td>
          </tr>
          <tr>
            <td>Covers</td>
            <td className="num">{data.covers}</td>
            <td className="num muted">{pct(data.covers)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
