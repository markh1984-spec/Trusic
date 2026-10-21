import type { OfflineCollection, TrackSummary } from "@trusic/client";
import { storageSize } from "@trusic/player";
import { Link } from "react-router";
import { RequireAuth } from "../components/Guards";
import { Icon } from "../components/Icon";
import { TrackList } from "../components/TrackList";
import { plural } from "../format";
import { usePlayTracks } from "../player";
import { useToast } from "../toast";
import { useDesktopOffline, type DesktopOffline } from "./offline";

const KINDS: Record<OfflineCollection["type"], string | null> = {
  release: "Release",
  playlist: "Playlist",
  liked: null,
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

/** Everything downloaded to this computer. Works offline: it only reads what's on disk. */
export function DownloadsPage() {
  const offline = useDesktopOffline();
  if (!offline) {
    return (
      <>
        <h1>Downloads</h1>
        <p className="muted">Downloads are in the Trusic app for Mac, Windows and Linux.</p>
      </>
    );
  }
  return (
    <RequireAuth>
      <Downloads offline={offline} />
    </RequireAuth>
  );
}

function Downloads({ offline }: { offline: DesktopOffline }) {
  const { state } = offline;
  const play = usePlayTracks();
  const toast = useToast();
  const tracksOf = (c: OfflineCollection) =>
    c.trackIds.map((id) => state.tracks[id]?.track).filter((t): t is TrackSummary => !!t);
  const all = Object.values(state.tracks).map((t) => t.track);
  const expired = state.validUntil ? Date.now() >= Date.parse(state.validUntil) : all.length > 0;

  const removeAll = async () => {
    if (!window.confirm("Remove all downloads from this computer? You can download them again later.")) return;
    await offline.removeAll();
    toast("Downloads removed");
  };

  return (
    <>
      <h1>Downloads</h1>
      <p className="muted">
        Music you download plays without a connection. It's kept inside the Trusic app on this computer, and only while
        you subscribe.
      </p>

      {state.notice ? <p className="note note--warn">{state.notice}</p> : null}
      {expired && all.length ? (
        <p className="note note--warn">
          Connect to the internet to keep playing your downloads. Trusic needs to check them at least every 30 days.
        </p>
      ) : null}

      <section className="stats downloads-stats" aria-label="Storage">
        <div className="stat">
          <span className="stat__value">{storageSize(state.bytes)}</span>
          <span className="stat__label">{plural(all.length, "track")} downloaded</span>
        </div>
        <div className="stat">
          <span className="stat__value downloads-stats__status">
            {state.progress
              ? `${state.progress.done} of ${state.progress.total}`
              : !offline.online
                ? "Offline"
                : state.waiting
                  ? "Waiting"
                  : "Up to date"}
          </span>
          <span className="stat__label">
            {state.progress
              ? "Downloading…"
              : state.validUntil && !expired
                ? `Plays offline until ${day(state.validUntil)}`
                : "Not checked yet"}
          </span>
        </div>
      </section>

      {state.collections.length === 0 ? (
        <p className="muted">
          Nothing downloaded yet. Use the Download button on an album, a playlist or your liked songs to listen without
          a connection.
        </p>
      ) : (
        <>
          <ul className="download-list">
            {state.collections.map((c) => {
              const tracks = tracksOf(c);
              const href = c.type === "liked" ? "/liked" : `/${c.type}/${c.id}`;
              return (
                <li key={`${c.type}:${c.id}`} className="download-list__item">
                  <button
                    className="play-button"
                    disabled={tracks.length === 0}
                    onClick={() => play(tracks, 0, c.title)}
                    aria-label={`Play ${c.title}`}
                  >
                    <Icon name="play" size={18} />
                  </button>
                  <div className="download-list__text">
                    {offline.online ? <Link to={href}>{c.title}</Link> : <strong>{c.title}</strong>}
                    <span className="muted small">
                      {[
                        KINDS[c.type],
                        c.subtitle,
                        tracks.length === c.trackIds.length
                          ? plural(tracks.length, "track")
                          : `${tracks.length} of ${c.trackIds.length} tracks downloaded`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <button
                    className="button button--ghost button--small"
                    onClick={() => void offline.setCollection(c, false)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          <h2>All downloaded tracks</h2>
          <TrackList tracks={all} label="Downloads" />
        </>
      )}

      {all.length || state.collections.length ? (
        <p>
          <button className="button button--ghost" onClick={() => void removeAll()}>
            Remove all downloads
          </button>
        </p>
      ) : null}
    </>
  );
}
