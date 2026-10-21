import type { OfflineCollection } from "@trusic/client";
import { Link } from "react-router";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { useToast } from "../toast";
import { useDesktopOffline } from "./offline";

/**
 * Download a release, playlist or liked songs to play without a connection. Only appears in the desktop
 * app; the website doesn't offer downloads.
 */
export function DownloadButton({ collection }: { collection: OfflineCollection }) {
  const offline = useDesktopOffline();
  const { me } = useAuth();
  const toast = useToast();
  if (!offline || !me) return null;

  const on = offline.isOn(collection);
  const total = collection.trackIds.length;
  const done = collection.trackIds.filter((id) => offline.state.tracks[id]).length;
  const label = !on
    ? "Download"
    : done >= total
      ? "Downloaded"
      : offline.state.waiting?.reason === "offline" && !offline.state.busy
        ? `Waiting for a connection (${done} of ${total})`
        : `Downloading ${done} of ${total}`;

  const toggle = () => {
    if (me.user.plan !== "premium") {
      toast("Downloads are for subscribers. Subscribe to listen offline.");
      return;
    }
    if (!on && total === 0) return;
    void offline
      .setCollection(collection, !on)
      .catch((e: unknown) => toast(e instanceof Error ? e.message : "Couldn't change your downloads."));
    toast(on ? `Removed "${collection.title}" from your downloads` : `Downloading "${collection.title}"`);
  };

  return (
    <span className="download-toggle">
      <button
        className={`button button--ghost${on ? " download-toggle--on" : ""}`}
        aria-pressed={on}
        onClick={toggle}
        title={on ? "Remove from downloads" : "Download to play offline"}
      >
        <Icon name={on && done >= total ? "check" : "download"} size={18} /> {label}
      </button>
      {on ? (
        <Link to="/downloads" className="muted small">
          See downloads
        </Link>
      ) : null}
    </span>
  );
}
