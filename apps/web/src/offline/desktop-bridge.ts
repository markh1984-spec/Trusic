/**
 * What the desktop app gives the web app (apps/desktop/src/main-preload.ts). On the website there's no
 * `window.trusicDesktop`, so nothing about downloads appears there.
 */
export type DesktopDownloadResult =
  { ok: true; bytes: number } | { ok: false; offline: boolean; status: number; message: string };

export interface DesktopOfflineBridge {
  /** This computer's id for downloads, the saved list of downloads, and whether the server answers. */
  load(): Promise<{ deviceId: string; manifest: unknown; online: boolean }>;
  saveManifest(manifest: unknown): Promise<void>;
  /** Download one track from a signed link, plus its artwork. */
  download(trackId: string, url: string, artworkUrl: string | null): Promise<DesktopDownloadResult>;
  remove(trackIds: string[]): Promise<void>;
  removeAll(): Promise<void>;
  prune(keepTrackIds: string[]): Promise<void>;
  /** Hear when the server stops or starts answering. Returns a function that stops listening. */
  onConnectionChange(listener: (online: boolean) => void): () => void;
}

interface TrusicDesktop {
  version: number;
  offline: DesktopOfflineBridge;
}

declare global {
  interface Window {
    trusicDesktop?: TrusicDesktop;
  }
}

/** The desktop app's downloads, or null on the website. */
export function desktopBridge(): DesktopOfflineBridge | null {
  return typeof window !== "undefined" ? (window.trusicDesktop?.offline ?? null) : null;
}

/** A name for this computer in the account's list of devices. */
export function computerName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "Linux computer";
}
