import { sharePath, type ShareKind } from "@trusic/client";
import { useEffect } from "react";
import { api } from "./api";

/** Something with its own page that can be shared: a track, release, artist or playlist. */
export interface ShareTarget {
  kind: ShareKind;
  /** The id, or the slug for artists. */
  key: string;
  /** "Chalk Paths · The Hollow Pines", used by the phone's share sheet and the embed's title. */
  title: string;
}

let siteOrigin: Promise<string> | null = null;

/** The site's address. The web app runs on it; the desktop app runs from app:// and asks the server instead. */
export function origin(): Promise<string> {
  if (/^https?:$/.test(window.location.protocol)) return Promise.resolve(window.location.origin);
  siteOrigin ??= api
    .siteInfo()
    .then((site) => site.url)
    .catch(() => {
      siteOrigin = null;
      return window.location.origin;
    });
  return siteOrigin;
}

export async function shareUrl(target: ShareTarget): Promise<string> {
  return (await origin()) + sharePath(target.kind, target.key);
}

/** Phones (touch screens with a share sheet) share; computers copy the link. */
export const usesShareSheet = (): boolean =>
  typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or no clipboard permission: copy from a hidden text box instead.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

/**
 * Name the browser tab after the page, as the server does for shared links, and go back to "Trusic" on leaving
 * (otherwise a shared track's title would stay in the tab).
 */
export function usePageTitle(title: string | null): void {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · Trusic`;
    return () => {
      document.title = "Trusic";
    };
  }, [title]);
}

/** Open the share sheet on phones, or copy the link, then say what happened. */
export async function shareLink(target: ShareTarget, toast: (message: string) => void): Promise<void> {
  const url = await shareUrl(target);
  if (usesShareSheet()) {
    try {
      await navigator.share({ title: target.title, url });
      toast("Link shared");
      return;
    } catch (e) {
      // Closing the share sheet isn't an error. Anything else falls back to copying.
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }
  toast((await copyText(url)) ? "Link copied" : "Couldn't copy the link. Copy it from the address bar instead.");
}
