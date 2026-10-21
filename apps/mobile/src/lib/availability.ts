/**
 * What the phone says about things that aren't live, in the website's words. Listeners never see them: the server
 * says "not found", and the app shows a friendly "isn't available" screen. A track's uploader (and Trusic's admins)
 * can still open it, and are told why it isn't live and what they can do. Kept apart from React Native so it can
 * be tested.
 */
import { REPORT_REASON_NAMES, type TrackAvailability } from "@trusic/client";

export type UnavailableKind = "track" | "release" | "artist" | "playlist";

export const UNAVAILABLE_PAGES: Record<UnavailableKind, { title: string; why: string }> = {
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

export interface StatusNotice {
  tone: "info" | "warn";
  title: string;
  paragraphs: string[];
  /** Convert a failed upload again, or open the takedown on the website (counter-notices are sent there). */
  action: { kind: "retry"; label: string } | { kind: "website"; label: string; path: string } | null;
}

/** Why a track isn't live, for its uploader or an admin. */
export function trackStatusNotice(u: TrackAvailability, viewer: "uploader" | "admin"): StatusNotice {
  if (viewer === "admin") return forAdmin(u);
  switch (u.status) {
    case "processing":
      return {
        tone: "info",
        title: "Getting this track ready",
        paragraphs: [
          "We're converting it for streaming and evening out its volume. It usually takes a minute or two, and this " +
            "screen updates by itself. Until then, only you can see it.",
        ],
        action: null,
      };
    case "failed":
      return {
        tone: "warn",
        title: "We couldn't prepare this track for streaming",
        paragraphs: [
          `${u.failure?.reason ?? "Something went wrong while converting it."} Only you can see it.`,
          `If ${u.failure?.canRetry ? "trying again doesn't work" : "it keeps happening"}, export it again as WAV, FLAC ` +
            "or MP3 and upload that on the Trusic website.",
        ],
        action: u.failure?.canRetry ? { kind: "retry", label: "Try again" } : null,
      };
    case "suspended":
      return {
        tone: "warn",
        title: "This track is hidden while your account is suspended",
        paragraphs: [
          "Your account was suspended after three strikes (false AI declarations or upheld copyright claims). Your " +
            "tracks are hidden and don't earn money until Trusic reinstates it. Contact Trusic to appeal.",
        ],
        action: null,
      };
    case "removed":
      return {
        tone: "info",
        title: "You removed this track",
        paragraphs: [
          "It's no longer on Trusic, and only you can see this screen. Its past plays and earnings still show in " +
            "your statements.",
        ],
        action: null,
      };
    case "taken_down": {
      const t = u.takedown;
      if (!t) {
        return {
          tone: "warn",
          title: "This track has been taken down",
          paragraphs: [
            "It was taken down after a report. It's hidden everywhere on Trusic, can't be played and earns nothing.",
          ],
          action: null,
        };
      }
      return {
        tone: "warn",
        title: "This track has been taken down",
        paragraphs: [
          `It was reported for ${REPORT_REASON_NAMES[t.reason].toLowerCase()} and taken down, so it's hidden ` +
            "everywhere on Trusic, can't be played and earns nothing while it's down.",
          ...(t.note ? [`Trusic's reason: “${t.note}”`] : []),
          ...(t.canCounterNotice
            ? [
                "Think we got it wrong? You can send a counter-notice on the Trusic website explaining why, and a person at Trusic will look at it.",
              ]
            : t.status === "counter_notice"
              ? ["We've received your counter-notice and we're looking at it. We'll email you our decision."]
              : []),
          `Reference ${t.reference}.`,
        ],
        action: {
          kind: "website",
          label: t.canCounterNotice ? "Send a counter-notice" : "See the takedown",
          path: `/takedown/${t.reportId}`,
        },
      };
    }
  }
}

const ADMIN_TITLES: Record<TrackAvailability["status"], string> = {
  processing: "Not live yet: still being converted",
  failed: "Not live: converting the upload failed",
  suspended: "Hidden: the uploader's account is suspended",
  taken_down: "Taken down after a report",
  removed: "Removed by the uploader",
};

function forAdmin(u: TrackAvailability): StatusNotice {
  return {
    tone: "warn",
    title: ADMIN_TITLES[u.status],
    paragraphs: [
      ...(u.failure ? [u.failure.reason] : []),
      ...(u.takedown
        ? [
            `Reported for ${REPORT_REASON_NAMES[u.takedown.reason].toLowerCase()} (reference ${u.takedown.reference}).` +
              (u.takedown.note ? ` “${u.takedown.note}”` : ""),
          ]
        : []),
      "You can see it because you're a Trusic admin. Nobody else can.",
    ],
    action: null,
  };
}

/** For an artist page or playlist taken down after a report, which only its owner (and admins) can still open. */
export function takenDownNotice(kind: "artist" | "playlist", isOwner: boolean): { title: string; text: string } {
  if (kind === "playlist") {
    return {
      title: "This playlist has been taken down",
      text:
        "After a report, only you can see it, even if it's set to public. Studio on the Trusic website has the " +
        "reason, and how to send a counter-notice if you think we got it wrong.",
    };
  }
  return {
    title: "This artist page has been taken down",
    text:
      `After a report, it's hidden everywhere on Trusic with all its music, so only ${isOwner ? "you" : "its owner"} ` +
      "and Trusic's admins can see it." +
      (isOwner
        ? " Studio on the Trusic website has the reason, and how to send a counter-notice if you think we got it wrong."
        : ""),
  };
}
