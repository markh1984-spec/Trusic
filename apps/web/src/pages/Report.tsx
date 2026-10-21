import {
  REPORT_REASON_NAMES,
  REPORT_TARGET_NAMES,
  type CopyrightNotice,
  type ReportReason,
  type ReportReceipt,
  type ReportTarget,
  type ReportTargetType,
} from "@trusic/client";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { Artwork } from "../components/Artwork";
import { ErrorNote, Loading } from "../components/Guards";
import { useAsync } from "../hooks";

const TARGET_TYPES: ReportTargetType[] = ["track", "release", "artist", "playlist", "artwork"];

const REASON_HINTS: Record<ReportReason, string> = {
  copyright: "It uses music, words or artwork that you own, or act for the owner of, without permission.",
  offensive: "Hateful, threatening, violent or sexual content, or anything else that breaks the law.",
  impersonation: "It pretends to be a real artist, band or person.",
  ai_label: "Its AI label doesn't match how much AI was used. We'll review the track's AI score.",
};

/** "Report…" from a ⋯ menu lands here, as does the copyright page. */
export function ReportPage() {
  const { type, id } = useParams();
  if (!type || !id) return <ReportFinder />;
  if (!TARGET_TYPES.includes(type as ReportTargetType)) return <ErrorNote message="We can't report that." />;
  return <ReportForm type={type as ReportTargetType} id={id} />;
}

/** Turn a Trusic link into the thing to report. */
function ReportFinder() {
  const navigate = useNavigate();
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    let path = link.trim();
    try {
      path = new URL(path).pathname;
    } catch {
      // Not a full address: treat it as a path.
    }
    const m = /\/(track|release|artist|playlist)\/([^/?#]+)/.exec(path);
    if (!m) return setError("That doesn't look like a link to a track, release, artist or playlist on Trusic.");
    navigate(`/report/${m[1]}/${m[2]}`);
  };

  return (
    <form className="card form narrow" onSubmit={submit}>
      <h1>Report something on Trusic</h1>
      <p className="muted">
        The quickest way is the <strong>⋯</strong> menu on the track, release, artist or playlist: choose{" "}
        <strong>Report…</strong>. Or paste its link here.
      </p>
      {error ? <ErrorNote message={error} /> : null}
      <label>
        Link
        <input
          required
          placeholder="https://…/track/…"
          value={link}
          onChange={(e) => (setLink(e.target.value), setError(null))}
        />
      </label>
      <button className="button">Continue</button>
      <p className="muted small">
        Reporting a copyright problem? Read <Link to="/legal/copyright">how copyright notices work</Link> first.
      </p>
    </form>
  );
}

const emptyNotice: CopyrightNotice = {
  role: "owner",
  claimantName: "",
  organisation: "",
  address: "",
  phone: "",
  work: "",
  goodFaith: false,
  accurate: false,
  signature: "",
};

function ReportForm({ type, id }: { type: ReportTargetType; id: string }) {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const target = useAsync(() => api.reportTarget(type, id), [type, id]);
  const [scope, setScope] = useState<"whole" | "artwork">("whole");
  const [reason, setReason] = useState<ReportReason | null>((params.get("reason") as ReportReason) || null);
  const [details, setDetails] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<CopyrightNotice>(emptyNotice);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ReportReceipt | null>(null);

  if (target.error) return <ErrorNote message={target.error} />;
  if (!target.data) return <Loading />;
  const t: ReportTarget = target.data;
  const artworkOnly = scope === "artwork" && t.artwork;
  const reasons: ReportReason[] = ["copyright", "offensive", "impersonation"];
  if (t.type === "track" && !artworkOnly) reasons.push("ai_label");
  const set = <K extends keyof CopyrightNotice>(key: K, value: CopyrightNotice[K]) =>
    setNotice((n) => ({ ...n, [key]: value }));

  if (receipt) {
    return (
      <section className="card narrow">
        <h1>Thank you</h1>
        <p>
          We've received your report about <strong>{t.title}</strong>. Your reference is{" "}
          <strong>{receipt.reference}</strong>.
        </p>
        <p>
          A person at Trusic will look at it. We'll email {me && !email ? me.user.email : email.trim()} when we've
          decided what to do, or if we need to know more.
        </p>
        {t.path ? <Link to={t.path}>Back to {REPORT_TARGET_NAMES[t.type].toLowerCase()}</Link> : null}
      </section>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return setError("Choose what's wrong.");
    setBusy(true);
    setError(null);
    try {
      const optional = (s: string | undefined) => (s?.trim() ? s.trim() : undefined);
      setReceipt(
        await api.report({
          targetType: artworkOnly ? "artwork" : t.type,
          targetId: artworkOnly ? t.artwork!.name : t.id,
          reason,
          details: details.trim(),
          reporterName: optional(name),
          reporterEmail: optional(email),
          ...(reason === "copyright"
            ? {
                copyright: {
                  ...notice,
                  organisation: optional(notice.organisation),
                  phone: optional(notice.phone),
                },
              }
            : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your report.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form narrow" onSubmit={submit}>
      <h1>Report {REPORT_TARGET_NAMES[t.type].toLowerCase()}</h1>
      <div className="report-target">
        {t.artwork ? <Artwork url={t.artwork.url} title={t.title} size={64} round={t.type === "artist"} /> : null}
        <div>
          <p>
            <strong>{t.path ? <Link to={t.path}>{t.title}</Link> : t.title}</strong>
          </p>
          <p className="muted small">{t.description}</p>
        </div>
      </div>

      {t.artwork && t.type !== "artwork" ? (
        <fieldset className="choice-list">
          <legend>What are you reporting?</legend>
          <label className="choice">
            <input type="radio" name="scope" checked={scope === "whole"} onChange={() => setScope("whole")} />
            <span>The whole {REPORT_TARGET_NAMES[t.type].toLowerCase()}</span>
          </label>
          <label className="choice">
            <input type="radio" name="scope" checked={scope === "artwork"} onChange={() => setScope("artwork")} />
            <span>Only its {t.type === "artist" ? "photo" : "artwork"}</span>
          </label>
        </fieldset>
      ) : null}

      <fieldset className="choice-list">
        <legend>What's wrong?</legend>
        {reasons.map((r) => (
          <label key={r} className="choice">
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            <span>
              <strong>{REPORT_REASON_NAMES[r]}</strong>
              <span className="muted small">{REASON_HINTS[r]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {reason === "offensive" ? (
        <p className="note note--warn small">If someone is in immediate danger, call 999 first.</p>
      ) : null}

      <label>
        {reason === "copyright"
          ? "Which part of it copies your work?"
          : reason === "ai_label"
            ? "What makes you think the label is wrong?"
            : "Tell us what's wrong"}
        <textarea
          required
          minLength={10}
          maxLength={5000}
          rows={4}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </label>

      {reason === "copyright" ? (
        <fieldset className="notice-fields">
          <legend>Copyright notice</legend>
          <p className="small muted">
            We need these details to act on a copyright claim. We'll show the uploader your name or organisation and the
            work you've described, but not your address, phone number or email address.{" "}
            <Link to="/legal/copyright">How copyright notices work</Link>
          </p>
          <fieldset className="choice-list">
            <legend>Who are you?</legend>
            <label className="choice">
              <input type="radio" name="role" checked={notice.role === "owner"} onChange={() => set("role", "owner")} />
              <span>I own the copyright</span>
            </label>
            <label className="choice">
              <input type="radio" name="role" checked={notice.role === "agent"} onChange={() => set("role", "agent")} />
              <span>I'm authorised to act for the owner (for example a label, publisher or lawyer)</span>
            </label>
          </fieldset>
          <label>
            Your full name
            <input
              required
              maxLength={200}
              value={notice.claimantName}
              onChange={(e) => set("claimantName", e.target.value)}
            />
          </label>
          <label>
            Organisation (optional)
            <input maxLength={200} value={notice.organisation} onChange={(e) => set("organisation", e.target.value)} />
          </label>
          <label>
            Postal address
            <textarea
              required
              rows={3}
              maxLength={1000}
              value={notice.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </label>
          <label>
            Phone number (optional)
            <input type="tel" maxLength={50} value={notice.phone} onChange={(e) => set("phone", e.target.value)} />
          </label>
          <label>
            Your original work
            <textarea
              required
              rows={3}
              maxLength={2000}
              placeholder="Its title, who made it, and where it's published. A link helps."
              value={notice.work}
              onChange={(e) => set("work", e.target.value)}
            />
          </label>
          <label className="choice">
            <input type="checkbox" checked={notice.goodFaith} onChange={(e) => set("goodFaith", e.target.checked)} />
            <span>
              I believe in good faith that this use of the work isn't authorised by the copyright owner, their agent or
              the law.
            </span>
          </label>
          <label className="choice">
            <input type="checkbox" checked={notice.accurate} onChange={(e) => set("accurate", e.target.checked)} />
            <span>
              The information in this notice is accurate, and I own the copyright or am authorised to act for the owner.
            </span>
          </label>
          <label>
            Signature: type your full name
            <input
              required
              maxLength={200}
              value={notice.signature}
              onChange={(e) => set("signature", e.target.value)}
            />
          </label>
          <p className="small muted">
            Please only send a notice if you're sure. Taking music down affects the artist's income, and the uploader
            can dispute it with a counter-notice.
          </p>
        </fieldset>
      ) : null}

      {me ? (
        <p className="small muted">
          We'll reply to <strong>{me.user.email}</strong>.
        </p>
      ) : (
        <>
          <label>
            Your name (optional)
            <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Your email address
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <small className="muted">So we can tell you what happens, or ask for more details.</small>
          </label>
        </>
      )}

      {error ? <ErrorNote message={error} /> : null}
      <button className="button" disabled={busy}>
        {busy ? "Sending…" : "Send report"}
      </button>
    </form>
  );
}

/** Where the link in a "we need more information" email goes. */
export function ReporterReplyPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const view = useAsync(() => api.reporterView(id, token), [id, token]);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (view.error) return <ErrorNote message={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.replyToReport(id, token, message.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your reply.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <section className="card narrow">
        <h1>Thank you</h1>
        <p>We've added your reply to report {v.reference}. We'll email you when we've decided what to do.</p>
      </section>
    );
  }

  return (
    <form className="card form narrow" onSubmit={submit}>
      <h1>Your report {v.reference}</h1>
      <p className="muted">About: {v.targetTitle}</p>
      {v.question ? <blockquote className="small">{v.question}</blockquote> : null}
      {v.canReply ? (
        <>
          <label>
            Your reply
            <textarea required rows={6} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          {error ? <ErrorNote message={error} /> : null}
          <button className="button" disabled={busy}>
            {busy ? "Sending…" : "Send reply"}
          </button>
        </>
      ) : (
        <p>This report isn't waiting for a reply from you any more.</p>
      )}
    </form>
  );
}
