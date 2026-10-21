import { REPORT_REASON_NAMES, REPORT_STATUS_NAMES, REPORT_TARGET_NAMES, type AdminReport } from "@trusic/client";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { STATUS_PILL, Thread } from "../pages/Takedown";
import { useAsync } from "../hooks";
import { useToast } from "../toast";
import { AiBadge } from "./AiBadge";
import { ErrorNote, Loading } from "./Guards";

const QUEUES = [
  { id: "action", name: "Needs action" },
  { id: "waiting", name: "Waiting for a reply" },
  { id: "closed", name: "Closed" },
] as const;

type Queue = (typeof QUEUES)[number]["id"];

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The takedown queue: copyright notices, offensive or illegal content, and impersonation. */
export function ReportsAdmin() {
  const [queue, setQueue] = useState<Queue>("action");
  const { data, error, loading, reload } = useAsync(() => api.adminReports({ queue, kind: "takedown" }), [queue]);
  const ref = useRef<HTMLElement>(null);
  // Emails to admins link to /admin#reports.
  useEffect(() => {
    if (window.location.hash === "#reports") ref.current?.scrollIntoView();
  }, []);

  return (
    <section className="card" id="reports" ref={ref}>
      <h2>Reports and takedowns</h2>
      <p className="muted small">
        Copyright notices, offensive or illegal content, and impersonation. Deal with copyright notices and illegal
        content quickly: acting fast once we know about a problem is what protects Trusic legally. Wrong-label reports
        are under Score appeals.
      </p>
      <div className="chips" role="tablist">
        {QUEUES.map((q) => (
          <button
            key={q.id}
            role="tab"
            aria-selected={queue === q.id}
            className={`chip${queue === q.id ? " chip--active" : ""}`}
            onClick={() => setQueue(q.id)}
          >
            {q.name}
          </button>
        ))}
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data?.length === 0 ? <p className="muted">Nothing here.</p> : null}
      {data?.map((r) => (
        <ReportItem key={r.id} report={r} onDone={reload} />
      ))}
      <CopyrightStrikes />
    </section>
  );
}

function Facts({ report: r }: { report: AdminReport }) {
  const c = r.copyright;
  return (
    <dl className="report-item__facts">
      <dt>Reported</dt>
      <dd>
        {REPORT_TARGET_NAMES[r.targetType]}:{" "}
        {r.targetPath && r.targetState === "live" ? <Link to={r.targetPath}>{r.targetTitle}</Link> : r.targetTitle}{" "}
        <span className="muted small">
          (
          {r.targetState === "live"
            ? "visible now"
            : r.targetState === "taken_down"
              ? "taken down"
              : "no longer on Trusic"}
          )
        </span>
      </dd>
      <dt>Uploader</dt>
      <dd>
        {r.owner ? (
          <>
            {r.owner.displayName} <span className="muted">{r.owner.email}</span> · {r.owner.copyrightStrikes} copyright
            strike{r.owner.copyrightStrikes === 1 ? "" : "s"}
          </>
        ) : (
          "Unknown"
        )}
      </dd>
      <dt>From</dt>
      <dd>
        {r.reporter.name ?? "Anonymous"} {r.reporter.email ? <span className="muted">{r.reporter.email}</span> : null}
        {r.reporter.userId ? <span className="muted small"> (has an account)</span> : null}
      </dd>
      {c ? (
        <>
          <dt>Claimant</dt>
          <dd>
            {c.claimantName}
            {c.organisation ? `, ${c.organisation}` : ""} ({c.role === "owner" ? "the owner" : "acting for the owner"})
          </dd>
          <dt>Address</dt>
          <dd>{c.address}</dd>
          {c.phone ? (
            <>
              <dt>Phone</dt>
              <dd>{c.phone}</dd>
            </>
          ) : null}
          <dt>Their work</dt>
          <dd>{c.work}</dd>
          <dt>Statements</dt>
          <dd>
            {c.goodFaith ? "Good faith ✓" : "Good faith ✗"} · {c.accurate ? "Accurate and authorised ✓" : "Accuracy ✗"}{" "}
            · signed "{c.signature}"
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function ReportItem({ report: r, onDone }: { report: AdminReport; onDone(): void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const undecided = r.status === "open" || r.status === "needs_info";
  const down = r.status === "taken_down" || r.status === "counter_notice";

  const act = async (action: Parameters<typeof api.actOnReport>[1], done: string, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setError(null);
    try {
      await api.actOnReport(r.id, action, note.trim());
      toast(done);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="report-item">
      <div className="report-item__head">
        <strong>{r.reference}</strong>
        <span className={`pill${r.reason === "copyright" ? " pill--copyright" : ""}`}>
          {REPORT_REASON_NAMES[r.reason]}
        </span>
        <span className={`pill ${STATUS_PILL[r.status] ?? ""}`}>{REPORT_STATUS_NAMES[r.status]}</span>
        <span className="muted small">{when(r.createdAt)}</span>
      </div>
      <Facts report={r} />
      <blockquote className="small">{r.details}</blockquote>
      {r.counterNotice ? (
        <div className="note note--warn small">
          <strong>Counter-notice from {r.counterNotice.name}</strong> ({when(r.counterNotice.sentAt)}). They agreed to
          it being passed on, and state in good faith it was taken down by mistake.
        </div>
      ) : null}
      <Thread messages={r.messages} you="trusic" />
      {undecided || down ? (
        <div className="form">
          <label>
            Note{" "}
            <small className="muted">
              {undecided
                ? "Emailed to the uploader if you take it down, or to the reporter if you ask a question or reject it."
                : "Emailed to the uploader and the reporter."}
            </small>
            <textarea rows={2} value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error ? <ErrorNote message={error} /> : null}
          <div className="row">
            {undecided ? (
              <>
                <button
                  className="button button--danger"
                  disabled={busy || note.trim().length < 5}
                  onClick={() =>
                    void act(
                      "take_down",
                      "Taken down",
                      r.reason === "copyright"
                        ? "Take this down? The uploader gets a copyright strike, and three suspends their account."
                        : "Take this down?",
                    )
                  }
                >
                  Take down
                </button>
                <button
                  className="button button--ghost"
                  disabled={busy || note.trim().length < 5 || !r.reporter.email}
                  onClick={() => void act("request_info", "Question sent")}
                >
                  Ask for more information
                </button>
                <button
                  className="button button--ghost"
                  disabled={busy || note.trim().length < 5}
                  onClick={() => void act("reject", "Report rejected")}
                >
                  Reject
                </button>
              </>
            ) : null}
            {down ? (
              <button
                className="button"
                disabled={busy || note.trim().length < 5}
                onClick={() =>
                  void act("restore", "Put back", "Put this back? Any copyright strike from it is withdrawn.")
                }
              >
                Put it back
              </button>
            ) : null}
            {r.status === "counter_notice" ? (
              <button
                className="button button--ghost"
                disabled={busy || note.trim().length < 5}
                onClick={() => void act("keep_down", "Kept down")}
              >
                Keep it down
              </button>
            ) : null}
          </div>
          {r.status === "counter_notice" && r.reason === "copyright" ? (
            <p className="muted small">
              The claimant has been told about the counter-notice and asked to reply within 10 working days if they've
              started legal action. Waiting that long before putting it back is the usual practice; check with a lawyer.
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function CopyrightStrikes() {
  const { data } = useAsync(() => api.adminCopyrightStrikes(), []);
  if (!data?.length) return null;
  return (
    <>
      <h3>Copyright strikes</h3>
      <p className="muted small">
        Upheld copyright takedowns. Three that haven't been withdrawn suspend the account. Separate from AI declaration
        strikes.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Account</th>
            <th>What was taken down</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.map(({ strike: s, user }) => (
            <tr key={s.id}>
              <td className="muted">{new Date(s.createdAt).toLocaleDateString("en-GB")}</td>
              <td>
                {user.displayName} <span className="muted small">{user.email}</span>
              </td>
              <td className="small">{s.targetTitle}</td>
              <td>
                {s.withdrawn ? (
                  <span className="muted">Withdrawn</span>
                ) : (
                  <span className="status status--warn">Counts</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * Wrong-label reports from listeners, shown with the score appeals and settled with the same tools: set a new score,
 * set it and issue a strike for a false declaration, or leave it as it is.
 */
export function LabelReports() {
  const { data, error, reload } = useAsync(() => api.adminReports({ queue: "action", kind: "ai_label" }), []);
  if (error) return <ErrorNote message={error} />;
  if (!data?.length) return null;
  return (
    <>
      <h3>Wrong-label reports</h3>
      <p className="muted small">Listeners think these tracks' AI labels are wrong.</p>
      {data.map((r) => (
        <LabelReportItem key={r.id} report={r} onDone={reload} />
      ))}
    </>
  );
}

function LabelReportItem({ report: r, onDone }: { report: AdminReport; onDone(): void }) {
  const [score, setScore] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const t = r.track;

  const review = async (input: { score?: number; strike?: boolean }) => {
    setError(null);
    if (input.strike && !window.confirm("Issue a strike? The track's past earnings will be clawed back.")) return;
    try {
      await api.reviewLabelReport(r.id, { ...input, ...(note.trim() ? { note: note.trim() } : {}) });
      toast("Report settled");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't settle the report.");
    }
  };

  return (
    <article className="appeal">
      <div className="appeal__head">
        {t ? (
          <>
            <Link to={`/track/${t.id}`}>
              <strong>{t.title}</strong>
            </Link>
            <span className="muted">by {t.artist.name}</span>
            <AiBadge score={t.aiScore} />
          </>
        ) : (
          <strong>{r.targetTitle}</strong>
        )}
        <span className="muted small">{r.reference}</span>
      </div>
      {t ? (
        <p className="small">
          Declared <strong>{t.declaredScore}</strong>, now <strong>{t.aiScore}</strong> ({t.scoreSource}).
        </p>
      ) : null}
      <blockquote>{r.details}</blockquote>
      <p className="muted small">
        From {r.reporter.name ?? "a listener"} {r.reporter.email ? `(${r.reporter.email})` : ""}
      </p>
      {error ? <ErrorNote message={error} /> : null}
      <div className="row">
        <input
          type="number"
          min={0}
          max={100}
          placeholder="New score"
          value={score}
          onChange={(e) => setScore(e.target.value)}
          aria-label="New score"
        />
        <input
          placeholder="Note to the reporter (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Note"
        />
        <button className="button" disabled={score === ""} onClick={() => void review({ score: Number(score) })}>
          Change score
        </button>
        <button
          className="button button--danger"
          disabled={score === ""}
          onClick={() => void review({ score: Number(score), strike: true })}
        >
          Change + strike
        </button>
        <button className="button button--ghost" onClick={() => void review({})}>
          No change
        </button>
      </div>
      <p className="muted small">
        A new score works like a review: it overrides the declaration and detection. <strong>Change + strike</strong> is
        for a false declaration, exactly as with a rejected appeal: the artist gets an AI declaration strike and the
        track's over-earnings are clawed back.
      </p>
    </article>
  );
}
