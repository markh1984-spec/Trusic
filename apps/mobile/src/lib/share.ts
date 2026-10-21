/**
 * Share links, kept apart from React Native so they can be tested. The links are the website's own pages, the
 * same ones the website shares (`sharePath` in @trusic/client), so they show a preview wherever they're pasted.
 */
import { sharePath, type ShareKind } from "@trusic/client";
import type { ShareContent } from "react-native";

/** Something with its own page on the website: a track, release, artist or public playlist. */
export interface ShareTarget {
  kind: ShareKind;
  /** The id, or the slug for artists. */
  key: string;
  /** "Chalk Paths · The Hollow Pines", for the share sheet. */
  title: string;
}

/**
 * The website's address for share links: the one set in the app's settings, else the one the server gives
 * (its public address, which can differ from the address the phone uses to reach it), else the API's own.
 */
export function chooseSite(site: { configured: string | null; reported: string | null; fallback: string }): string {
  return (site.configured || site.reported || site.fallback).replace(/\/+$/, "");
}

export const shareUrl = (site: string, target: ShareTarget): string => site + sharePath(target.kind, target.key);

/**
 * What to hand the phone's share sheet. iPhones share the link itself, so apps can show its preview. Android
 * only shares text, so the link goes in the message there.
 */
export function shareContent(platform: string, target: ShareTarget, url: string): ShareContent {
  return platform === "android" ? { title: target.title, message: url } : { title: target.title, url };
}
