import type { ReportReason, ReportStatus, ReportTargetType } from "./types";

/** How report reasons are named to people, everywhere they're shown. */
export const REPORT_REASON_NAMES: Record<ReportReason, string> = {
  copyright: "Copyright infringement",
  offensive: "Offensive or illegal content",
  impersonation: "Impersonation",
  ai_label: "Wrong AI label",
};

export const REPORT_TARGET_NAMES: Record<ReportTargetType, string> = {
  track: "Track",
  release: "Release",
  artist: "Artist",
  playlist: "Playlist",
  artwork: "Artwork",
};

export const REPORT_STATUS_NAMES: Record<ReportStatus, string> = {
  open: "Waiting for review",
  needs_info: "Waiting for more information",
  taken_down: "Taken down",
  rejected: "Not taken down",
  counter_notice: "Counter-notice received",
  restored: "Put back",
  resolved: "Reviewed",
};

/** The short reference people quote, e.g. "3F2A9C1B". */
export const reportReference = (id: string) => id.slice(0, 8).toUpperCase();
