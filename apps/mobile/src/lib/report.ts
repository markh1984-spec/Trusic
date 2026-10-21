/**
 * The phone's report form, kept apart from React Native so its rules can be tested. Reasons and their names come
 * from @trusic/client, as on the website. Copyright notices need several legal statements, so the phone sends
 * people to the website's form for those.
 */
import type { ReportReason, ReportTargetType } from "@trusic/client";

/** Reasons the phone's own form takes. Wrong AI labels belong to tracks. */
export function phoneReportReasons(type: ReportTargetType): ReportReason[] {
  return type === "track" ? ["offensive", "impersonation", "ai_label"] : ["offensive", "impersonation"];
}

export const REASON_HINTS: Record<ReportReason, string> = {
  copyright: "It uses music, words or artwork that you own, or act for the owner of, without permission.",
  offensive: "Hateful, threatening, violent or sexual content, or anything else that breaks the law.",
  impersonation: "It pretends to be a real artist, band or person.",
  ai_label: "Its AI label doesn't match how much AI was used. We'll review the track's AI score.",
};

/** The same minimum the server asks for. */
export const MIN_DETAILS = 10;

/** The first thing stopping the report from being sent, in plain words, or null when it's ready. */
export function reportProblem(form: {
  reason: ReportReason | null;
  details: string;
  /** Visitors give an email address so Trusic can reply; signed-in listeners are replied to at theirs. */
  email: string | null;
}): string | null {
  if (!form.reason) return "Choose what's wrong.";
  if (form.details.trim().length < MIN_DETAILS) return "Tell us a little more: at least 10 characters.";
  if (form.email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    return "Give us your email address so we can tell you what happens.";
  }
  return null;
}

/** The website's report form, for copyright notices. */
export const websiteReportPath = (type: ReportTargetType, id: string, reason?: ReportReason) =>
  `/report/${type}/${encodeURIComponent(id)}${reason ? `?reason=${reason}` : ""}`;
