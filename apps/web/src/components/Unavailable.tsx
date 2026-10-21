import { Link } from "react-router";
import { useAuth } from "../auth";
import { usePageTitle } from "../share";
import { ErrorNote } from "./Guards";
import { Icon } from "./Icon";
import "../notices.css";

export type UnavailableKind = "track" | "release" | "artist" | "playlist";

const PAGES: Record<UnavailableKind, { title: string; why: string }> = {
  track: {
    title: "This track isn't available",
    why: "The artist may have removed it, it may have been taken down after a report, or the link may be wrong.",
  },
  release: {
    title: "This release isn't available",
    why: "The artist may have deleted it, it may have been taken down after a report, or the link may be wrong.",
  },
  artist: {
    title: "This artist isn't available",
    why: "The profile may have been taken down after a report or deleted, or the link may be wrong.",
  },
  playlist: {
    title: "This playlist isn't available",
    why: "Its owner may have made it private or deleted it, it may have been taken down after a report, or the link may be wrong.",
  },
};

/** What people see instead of something they can't open: no error codes, and somewhere to go next. */
export function Unavailable({ kind }: { kind: UnavailableKind }) {
  const { me } = useAuth();
  const page = PAGES[kind];
  usePageTitle(page.title);
  return (
    <section className="unavailable">
      <span className="unavailable__icon" aria-hidden>
        <Icon name="info" size={28} />
      </span>
      <h1>{page.title}</h1>
      <p className="muted">{page.why}</p>
      {me?.artists.length && kind !== "playlist" ? (
        <p className="small muted">
          If it's yours, <Link to="/studio">Studio</Link> says what's happened and what you can do.
        </p>
      ) : null}
      <div className="row unavailable__actions">
        <Link to="/" className="button">
          Back to the music
        </Link>
        <Link to="/search" className="button button--ghost">
          Search Trusic
        </Link>
      </div>
    </section>
  );
}

/**
 * A page that couldn't load: the friendly page when it doesn't exist or isn't yours to see (the server says "not
 * found" either way, so nothing is given away), and the message for anything else, like being offline.
 */
export function LoadFailed({ kind, error, status }: { kind: UnavailableKind; error: string; status: number | null }) {
  if (status === 404 || status === 400) return <Unavailable kind={kind} />;
  return <ErrorNote message={error} />;
}
