import type { DownloadDevice } from "@trusic/client";
import { useState } from "react";
import { api } from "../api";
import { ErrorNote, Loading } from "../components/Guards";
import { plural } from "../format";
import { useAsync } from "../hooks";
import { useToast } from "../toast";
import "../notices.css";

const PLATFORMS: Record<DownloadDevice["platform"], string> = {
  ios: "iPhone or iPad",
  android: "Android",
  desktop: "Desktop app",
  web: "Web browser",
};

/** "3 hours ago", "yesterday", "12 days ago", or the date for anything older than a month. */
export function whenCheckedIn(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return "less than an hour ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 31) return `${days} days ago`;
  return `on ${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
}

/**
 * Settings: the phones and computers keeping downloads for this account, and a way to remove one (a lost phone,
 * say). Its downloads are deleted the next time it goes online, and its place is free straight away.
 */
export function YourDevices() {
  const { data, error, loading, reload } = useAsync(() => api.downloadDevices(), []);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const keeping = data?.filter((d) => !d.removedBy).length ?? 0;

  const remove = async (device: DownloadDevice) => {
    const sure = window.confirm(
      `Remove "${device.name}"? Its downloads will be deleted the next time it goes online. You can download again on it later.`,
    );
    if (!sure) return;
    setBusy(device.id);
    try {
      await api.removeDownloadDevice(device.id);
      toast(`"${device.name}" removed`);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card settings-section">
      <h2>Your devices</h2>
      <p className="muted">
        Phones and computers keeping downloads to listen to offline, in the Trusic phone and desktop apps. Downloads
        work on up to five at once. Removing one deletes its downloads the next time it goes online, and frees its place
        straight away.
      </p>
      {error ? <ErrorNote message={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && data.length === 0 ? (
        <p className="small">
          No devices are keeping downloads. Subscribers can download albums, playlists and liked songs in the Trusic
          phone and desktop apps.
        </p>
      ) : null}
      {data?.length ? (
        <>
          <ul className="device-list">
            {data.map((d) => (
              <li key={d.id}>
                <span className="device-list__about">
                  <strong>{d.name}</strong>
                  <span className="small muted">
                    {PLATFORMS[d.platform] ?? d.platform} · checked in {whenCheckedIn(d.lastCheckedAt)}
                    {d.trackCount !== null ? ` · ${plural(d.trackCount, "track")} downloaded` : ""}
                  </span>
                </span>
                {d.removedBy ? (
                  <span className="pill pill--warn">
                    {d.removedBy === "listener"
                      ? "Removed: downloads go when it's next online"
                      : "Pushed out by five newer devices: downloads go when it's next online"}
                  </span>
                ) : (
                  <button
                    className="button button--ghost button--small"
                    disabled={busy !== null}
                    onClick={() => void remove(d)}
                  >
                    {busy === d.id ? "Removing…" : "Remove"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="small muted">{keeping} of 5 places in use.</p>
        </>
      ) : null}
    </section>
  );
}
