import {
  REPORT_REASON_NAMES,
  REPORT_STATUS_NAMES,
  type MyTakedown,
  type ReportMessage,
  type ReportStatus,
} from "@trusic/client";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { ErrorNote, Loading, RequireAuth } from "../components/Guards";
import { useAsync } from "../hooks";

export const STATUS_PILL: Partial<Record<ReportStatus, string>> = {
  taken_down: "pill--danger",
  counter_notice: "pill--warn",
  restored: "pill--ok",
  rejected: "pill--ok",
  resolved: "pill--ok",
};

const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function Thread({ messages, you }: { messages: ReportMessage[]; you: ReportMessage["from"] }) {
  if (!messages.length) return null;
  const who = (m: ReportMessage) =>
    m.from === you ? "You" : m.from === "trusic" ? "Trusic" : m.from === "uploader" ? "Uploader" : "Reporter";
  return (
    <ul className="thread">
      {messages.map((m) => (
        <li key={m.id}>
          <span className="thread__who">
            {who(m)} · {date(m.createdAt)}
          </span>
          {m.body}
        </li>
      ))}
    </ul>
  );
}

/** Where a takedown email sends the uploader: what happened, and how to dispute it. */
export function TakedownPage() {
  return (
    <RequireAuth>
      <Takedown />
    </RequireAuth>
  );
}

function Takedown() {
  const { id = "" } = useParams();
  const { data, error, reload } = useAsync(() => api.myTakedowns(), []);
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  const takedown = data.takedowns.find((d) => d.id === id);
  if (!takedown) return <ErrorNote message="We couldn't find that takedown on your account." />;
  const active = data.copyrightStrikes.filter((s) => !s.withdrawn).length;

  return (
    <div className="narrow">
      <p className="eyebrow">Takedown {takedown.reference}</p>
      <h1>{takedown.targetTitle}</h1>
      <p>
        <span className={`pill ${STATUS_PILL[takedown.status] ?? ""}`}>{REPORT_STATUS_NAMES[takedown.status]}</span>{" "}
        <span className="muted">
          Reported for {REPORT_REASON_NAMES[takedown.reason].toLowerCase()} on {date(takedown.createdAt)}
        </span>
      </p>
      <section className="card">
        <h2>What happened</h2>
        {takedown.claimant ? (
          <p className="small">
            <strong>{takedown.claimant.organisation ?? takedown.claimant.name}</strong>
            {takedown.claimant.organisation ? ` (${takedown.claimant.name})` : ""} says this copies their work:{" "}
            {takedown.claimant.work}
          </p>
        ) : null}
        <Thread messages={takedown.messages} you="uploader" />
        {takedown.status === "taken_down" || takedown.status === "counter_notice" ? (
          <p className="small muted">
            While it's down it's hidden everywhere on Trusic, can't be played, and doesn't earn money.
          </p>
        ) : null}
        {takedown.reason === "copyright" ? (
          <p className="small">
            Copyright strikes on your account:{" "}
            <strong>
              {active} of {data.strikesToSuspend}
            </strong>
            . At {data.strikesToSuspend}, your account is suspended. These are separate from strikes for false AI
            declarations.
          </p>
        ) : null}
      </section>
      {takedown.status === "taken_down" && !takedown.counterNotice ? (
        <CounterNoticeForm takedown={takedown} onSent={reload} />
      ) : null}
      {takedown.status === "counter_notice" ? (
        <p className="note">
          We've received your counter-notice and we're looking at it. We'll email you our decision.
        </p>
      ) : null}
      <p className="small">
        <Link to="/studio">Back to Studio</Link>
      </p>
    </div>
  );
}

function CounterNoticeForm({ takedown, onSent }: { takedown: MyTakedown; onSent(): void }) {
  const copyright = takedown.reason === "copyright";
  const [explanation, setExplanation] = useState("");
  const [goodFaith, setGoodFaith] = useState(false);
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.counterNotice(takedown.id, {
        explanation: explanation.trim(),
        goodFaith,
        consentToShare: consent,
        name: name.trim(),
      });
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your counter-notice.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Think we got this wrong?</h2>
      <p className="small">
        Send a counter-notice explaining why. A person at Trusic will read it, and we'll pass it on to whoever reported
        it.
        {copyright
          ? " They can tell us within 10 working days if they've started legal action. If they don't, we may put it back."
          : " If we agree, we'll put it back."}{" "}
        You can send one counter-notice for each takedown.
      </p>
      {error ? <ErrorNote message={error} /> : null}
      <label>
        Why it should go back up
        <textarea
          required
          minLength={20}
          maxLength={5000}
          rows={5}
          placeholder={
            copyright
              ? "For example: you wrote and recorded it yourself, you have a licence, or it's been mistaken for something else."
              : "Explain why it doesn't break our rules."
          }
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
        />
      </label>
      <label className="choice">
        <input type="checkbox" checked={goodFaith} onChange={(e) => setGoodFaith(e.target.checked)} />
        <span>
          I believe in good faith that this was taken down by mistake, or because it was mistaken for something else.
        </span>
      </label>
      <label className="choice">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Trusic can pass this counter-notice, with my name and email address, to the person who reported it.</span>
      </label>
      <label>
        Signature: type your full name
        <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button className="button" disabled={busy || !goodFaith || !consent}>
        {busy ? "Sending…" : "Send counter-notice"}
      </button>
    </form>
  );
}
