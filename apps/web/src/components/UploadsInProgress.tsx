import type { TrackDetail, UploadInProgress } from "@trusic/client";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useToast } from "../toast";

/** How often to check on uploads that are being prepared for streaming. */
const POLL_MS = 4000;

/**
 * Studio's list of uploads that aren't live yet. While any are processing it checks every few seconds, and calls
 * `onLive` when one is done so the page can show it with the artist's other tracks.
 */
export function UploadsInProgress({ onLive }: { onLive(): void }) {
  const toast = useToast();
  const [uploads, setUploads] = useState<UploadInProgress[]>([]);
  const [version, setVersion] = useState(0);
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waiting: Set<string> | null = null;
    const check = async () => {
      try {
        const list = await api.myUploads();
        if (cancelled) return;
        const processing = new Set(list.filter((u) => u.status === "processing").map((u) => u.track.id));
        if (waiting && [...waiting].some((id) => !processing.has(id))) onLiveRef.current();
        waiting = processing;
        setUploads(list);
        if (processing.size) timer = setTimeout(check, POLL_MS);
      } catch {
        if (!cancelled) timer = setTimeout(check, POLL_MS * 3);
      }
    };
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [version]);

  if (!uploads.length) return null;
  const busy = uploads.some((u) => u.status === "processing");

  const remove = async (id: string) => {
    await api.removeTrack(id).catch(() => undefined);
    setVersion((v) => v + 1);
  };
  /** Convert it again from the file that was uploaded. The list then shows it processing, and checks on it. */
  const retry = async (id: string) => {
    try {
      await api.retryUpload(id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work. Please try again.");
    }
    setVersion((v) => v + 1);
  };

  return (
    <section className="card">
      <h2>Uploads in progress</h2>
      <ul className="plain-list">
        {uploads.map((u) => (
          <li key={u.track.id}>
            <span>
              <Link to={`/track/${u.track.id}`}>{u.track.title}</Link>
              <span className="muted"> · {u.artist.name}</span>
              {u.message ? (
                <span className="small text-danger" style={{ display: "block" }}>
                  {u.message}
                </span>
              ) : null}
            </span>
            {u.status === "processing" ? (
              <span className="status">Processing…</span>
            ) : (
              <span className="row">
                <span className="status status--warn">Failed</span>
                {u.canRetry ? (
                  <button className="button button--small" onClick={() => void retry(u.track.id)}>
                    Try again
                  </button>
                ) : null}
                <button className="button button--ghost button--small" onClick={() => void remove(u.track.id)}>
                  Remove
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {busy ? (
        <p className="muted small">
          We're converting the audio for streaming and evening out its volume. It usually takes a minute or two, and the
          track goes live by itself.
        </p>
      ) : null}
    </section>
  );
}

/** While `track` is processing, check on it every few seconds and call `reload` once it's done. */
export function useReloadWhenProcessed(track: TrackDetail | null, reload: () => void) {
  const id = track?.id;
  const processing = track?.processing === "processing";
  useEffect(() => {
    if (!id || !processing) return;
    const timer = setInterval(() => {
      api
        .track(id)
        .then((t) => t.processing !== "processing" && reload())
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [id, processing, reload]);
}
