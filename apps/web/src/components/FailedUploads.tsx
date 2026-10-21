import type { FailedUpload } from "@trusic/client";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useAsync } from "../hooks";
import { useToast } from "../toast";
import { ErrorNote, Loading } from "./Guards";
import "../notices.css";

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

/**
 * Admin: uploads the server gave up on after a few tries. Audio that couldn't be converted (the artist sees it in
 * Studio and can try again too) and artwork that couldn't be resized (which stays as uploaded meanwhile).
 */
export function FailedUploads() {
  const { data, error, loading, reload } = useAsync(() => api.failedUploads(), []);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const retry = async (job: FailedUpload) => {
    setBusy(job.jobId);
    try {
      await api.retryFailedUpload(job.jobId);
      toast(job.kind === "audio" ? `Converting "${job.track?.title}" again` : "Resizing the picture again");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card failed-uploads">
      <h2>Failed uploads</h2>
      <p className="muted small">
        Uploads Trusic couldn't convert for streaming, or artwork it couldn't resize, after three tries. Trying again
        starts afresh from the file that was uploaded.
      </p>
      {error ? <ErrorNote message={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && data.length === 0 ? <p className="small">Nothing has failed.</p> : null}
      {data?.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Upload</th>
              <th>Why</th>
              <th>Failed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((job) => (
              <tr key={job.jobId}>
                <td>
                  {job.track ? <Link to={`/track/${job.track.id}`}>{job.track.title}</Link> : "Artwork"}
                  <span className="small muted" style={{ display: "block" }}>
                    {job.artist ? job.artist.name : "No longer used"}
                    {job.owner ? ` · ${job.owner.email}` : ""}
                  </span>
                </td>
                <td className="small">
                  {job.reason}
                  {job.error ? (
                    <details>
                      <summary className="muted">What the converter said</summary>
                      <code>{job.error}</code>
                    </details>
                  ) : null}
                </td>
                <td className="small muted">
                  {when(job.failedAt)}
                  <span style={{ display: "block" }}>{job.attempts} tries</span>
                </td>
                <td>
                  {job.canRetry ? (
                    <button
                      className="button button--ghost button--small"
                      disabled={busy !== null}
                      onClick={() => void retry(job)}
                    >
                      {busy === job.jobId ? "Starting…" : "Try again"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
