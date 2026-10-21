/**
 * Small rules for offline listening on the phone, kept apart from React Native so they can be tested.
 * The download rules themselves are shared with the desktop app, in @trusic/player.
 */
import type { TrackSummary } from "@trusic/client";

const EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
};

/** Every extension a download might have. */
export const AUDIO_EXTENSIONS = [...new Set(Object.values(EXTENSIONS))];

/**
 * The file extension for a download. Phones' players work out the format from it, so files keep one,
 * but they're named by track id inside the app's own storage, never in a music folder.
 */
export function audioExtension(mimeType: string): string {
  return EXTENSIONS[mimeType.split(";")[0]!.trim().toLowerCase()] ?? "audio";
}

/** The track id a downloaded file belongs to, from its name ("<id>.mp3"), or null for a partial download. */
export function trackIdOfFile(name: string): string | null {
  const m = /^([0-9a-f-]{36})\.([a-z0-9]+)$/.exec(name);
  return m && m[2] !== "part" ? m[1]! : null;
}

/**
 * What to play when the listener taps a track. Offline, only tracks that can play are queued, starting
 * from the one tapped; null if that one can't play.
 */
export function playableQueue(
  tracks: TrackSummary[],
  index: number,
  canPlay: (track: TrackSummary) => boolean,
): { tracks: TrackSummary[]; startIndex: number } | null {
  const tapped = tracks[index];
  if (!tapped || !canPlay(tapped)) return null;
  const playable = tracks.filter(canPlay);
  return { tracks: playable, startIndex: playable.indexOf(tapped) };
}

/** Whether downloads may run on this connection. "Wi-Fi only" lets them run on Wi-Fi or a cable. */
export function mayDownload(
  network: { type?: string; isConnected?: boolean },
  wifiOnly: boolean,
  platform: string,
): boolean {
  if (network.isConnected === false) return false;
  if (!wifiOnly) return true;
  // Browsers can't tell Wi-Fi from mobile data.
  if (platform === "web") return true;
  return network.type === "WIFI" || network.type === "ETHERNET";
}
