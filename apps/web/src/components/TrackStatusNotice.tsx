import { REPORT_REASON_NAMES, type TrackAvailability, type TrackDetail } from "@trusic/client";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { ErrorNote } from "./Guards";
import "../notices.css";

type Tone = "info" | "warn" | "error";

/**
 * On a track page, for its uploader (and admins): why the track isn't live, in plain words, and what to do next.
 * Everyone else can't open a track that isn't live, and sees "This track isn't available" instead.
 */
export function TrackStatusNotice({ track, onChange }: { track: TrackDetail; onChange(): void }) {
  const u = track.unavailable;
  if (!u) return null;
  const notice = track.isOwner ? forUploader(u, track, onChange) : forAdmin(u);
  return (
    <section className={`status-notice status-notice--${notice.tone}`} role="status">
      <h2>{notice.title}</h2>
      {notice.body}
    </section>
  );
}

function forUploader(u: TrackAvailability, track: TrackDetail, onChange: () => void) {
  switch (u.status) {
    case "processing":
      return {
        tone: "info" as Tone,
        title: "Getting this track ready",
        body: (
          <p>
            We're converting it for streaming and evening out its volume. It usually takes a minute or two, and this
            page updates by itself. Until then, only you can see it.
          </p>
        ),
      };
    case "failed":
      return {
        tone: "error" as Tone,
        title: "We couldn't prepare this track for streaming",
        body: (
          <>
            <p>{u.failure?.reason ?? "Something went wrong while converting it."} Only you can see it.</p>
            {u.failure?.canRetry ? <RetryButton trackId={track.id} onDone={onChange} /> : null}
            <p className="small muted">
              If {u.failure?.canRetry ? "trying again doesn't work" : "it keeps happening"}, export it again as WAV,
              FLAC or MP3 and upload that. You can remove this one in <Link to="/studio">Studio</Link>.
            </p>
          </>
        ),
      };
    case "suspended":
      return {
        tone: "warn" as Tone,
        title: "This track is hidden while your account is suspended",
        body: (
          <p>
            Your account was suspended after three strikes (false AI declarations or upheld copyright claims). Your
            tracks are hidden and don't earn money until Trusic reinstates it. Contact Trusic to appeal.
          </p>
        ),
      };
    case "taken_down":
      return { tone: "error" as Tone, title: "This track has been taken down", body: <TakenDown u={u} /> };
    case "removed":
      return {
        tone: "info" as Tone,
        title: "You removed this track",
        body: (
          <p>
            It's no longer on Trusic, and only you can see this page. Its past plays and earnings still show in your
            statements.
          </p>
        ),
      };
  }
}

function TakenDown({ u }: { u: TrackAvailability }) {
  const t = u.takedown;
  if (!t) {
    return (
      <p>It was taken down after a report. It's hidden everywhere on Trusic, can't be played and earns nothing.</p>
    );
  }
  return (
    <>
      <p>
        It was reported for {REPORT_REASON_NAMES[t.reason].toLowerCase()} and taken down, so it's hidden everywhere on
        Trusic, can't be played and earns nothing while it's down.
      </p>
      {t.note ? (
        <blockquote>
          <span className="small muted">Trusic's reason:</span>
          <br />
          {t.note}
        </blockquote>
      ) : null}
      {t.canCounterNotice ? (
        <p>
          Think we got it wrong? You can send a counter-notice explaining why, and a person at Trusic will look at it.
        </p>
      ) : t.status === "counter_notice" ? (
        <p>We've received your counter-notice and we're looking at it. We'll email you our decision.</p>
      ) : null}
      <div className="row">
        <Link to={`/takedown/${t.reportId}`} className={`button${t.canCounterNotice ? "" : " button--ghost"}`}>
          {t.canCounterNotice ? "Send a counter-notice" : "See the takedown"}
        </Link>
        <span className="small muted">Reference {t.reference}</span>
      </div>
    </>
  );
}

function forAdmin(u: TrackAvailability): { tone: Tone; title: string; body: ReactNode } {
  const seen = <p className="small muted">You can see it because you're a Trusic admin. Nobody else can.</p>;
  const titles: Record<TrackAvailability["status"], string> = {
    processing: "Not live yet: still being converted",
    failed: "Not live: converting the upload failed",
    suspended: "Hidden: the uploader's account is suspended",
    taken_down: "Taken down after a report",
    removed: "Removed by the uploader",
  };
  return {
    tone: u.status === "taken_down" || u.status === "failed" ? "error" : "warn",
    title: titles[u.status],
    body: (
      <>
        {u.failure ? <p>{u.failure.reason}</p> : null}
        {u.takedown ? (
          <p>
            Reported for {REPORT_REASON_NAMES[u.takedown.reason].toLowerCase()} (reference {u.takedown.reference}).
            {u.takedown.note ? ` “${u.takedown.note}”` : ""}
          </p>
        ) : null}
        {seen}
      </>
    ),
  };
}

/** Convert a failed upload again, from the file the artist uploaded. */
export function RetryButton({ trackId, onDone }: { trackId: string; onDone(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="row">
      <button
        className="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          api
            .retryUpload(trackId)
            .then(onDone)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "That didn't work. Please try again."))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Starting…" : "Try again"}
      </button>
      {error ? <ErrorNote message={error} /> : null}
    </div>
  );
}
