import { reportReference, type TrackAvailability } from "@trusic/client";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { mediaJobs, reportMessages, reports, type TrackStatus } from "./db/schema";
import { failureReason } from "./media/failures";

/**
 * Why a track isn't live, for the notice its uploader (or an admin) sees on its page: the conversion's failure in
 * plain words, or the takedown behind it, with Trusic's reason and whether a counter-notice can still be sent.
 */
export async function trackAvailability(
  db: Db,
  track: { id: string; status: TrackStatus; originalAudioKey: string | null },
  viewer: { id: string },
): Promise<TrackAvailability | null> {
  const { status } = track;
  if (status === "live") return null;

  if (status === "failed") {
    const [job] = await db
      .select({ error: mediaJobs.error })
      .from(mediaJobs)
      .where(and(eq(mediaJobs.trackId, track.id), eq(mediaJobs.kind, "audio")))
      .limit(1);
    return {
      status,
      failure: { reason: failureReason(job?.error ?? null), canRetry: track.originalAudioKey !== null },
      takedown: null,
    };
  }

  if (status === "taken_down") {
    // Whatever was reported (the track, its release or its artist), the takedown lists every track it took down.
    const [report] = await db
      .select()
      .from(reports)
      .where(
        and(
          isNotNull(reports.takedown),
          inArray(reports.status, ["taken_down", "counter_notice"]),
          sql`${reports.takedown} -> 'tracks' @> ${JSON.stringify([{ id: track.id }])}::jsonb`,
        ),
      )
      .orderBy(desc(reports.decidedAt))
      .limit(1);
    const [note] = report
      ? await db
          .select({ body: reportMessages.body })
          .from(reportMessages)
          .where(and(eq(reportMessages.reportId, report.id), eq(reportMessages.kind, "taken_down")))
          .orderBy(desc(reportMessages.createdAt))
          .limit(1)
      : [];
    return {
      status,
      failure: null,
      takedown: report
        ? {
            reportId: report.id,
            reference: reportReference(report.id),
            reason: report.reason,
            note: note?.body ?? null,
            status: report.status,
            canCounterNotice:
              report.status === "taken_down" && !report.counterNotice && report.ownerUserId === viewer.id,
          }
        : null,
    };
  }

  return { status, failure: null, takedown: null };
}
