/**
 * The browser build's version of offline-storage.ts, so downloads can be tried in a browser too:
 * documents in localStorage, and tracks in the browser's Cache Storage (private to this site).
 */
import { ApiError } from "@trusic/client";
import type { OfflineFiles } from "@trusic/player";
import { api } from "./api";

export interface JsonDocument<T> {
  load(): Promise<T | null>;
  /** Null deletes it. */
  save(value: T | null): Promise<void>;
}

export function jsonDocument<T>(name: string): JsonDocument<T> {
  const key = `trusic.offline.${name}`;
  return {
    async load() {
      try {
        return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
      } catch {
        return null;
      }
    },
    async save(value) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Storage unavailable (private browsing): nothing is kept.
      }
    },
  };
}

const CACHE = "trusic-offline-audio";
const keyFor = (trackId: string) => `/offline-audio/${trackId}`;
/** Object URLs handed to the player, so each track is only read from the cache once. */
const objectUrls = new Map<string, string>();

function forget(trackId: string) {
  const url = objectUrls.get(trackId);
  if (url) URL.revokeObjectURL(url);
  objectUrls.delete(trackId);
}

export const audioFiles: OfflineFiles & { localUri(trackId: string): Promise<string | null> } = {
  async download(track, url, mimeType) {
    const res = await fetch(api.resolveUrl(url));
    if (!res.ok) throw new ApiError(res.status, "Couldn't download this track.");
    const blob = await res.blob();
    const cache = await caches.open(CACHE);
    await cache.put(keyFor(track.id), new Response(blob, { headers: { "content-type": mimeType } }));
    forget(track.id);
    return blob.size;
  },

  async remove(trackIds) {
    const cache = await caches.open(CACHE);
    for (const id of trackIds) {
      forget(id);
      await cache.delete(keyFor(id));
    }
  },

  async removeAll() {
    for (const id of [...objectUrls.keys()]) forget(id);
    await caches.delete(CACHE);
  },

  async prune(keep) {
    const cache = await caches.open(CACHE);
    for (const request of await cache.keys()) {
      const id = new URL(request.url).pathname.split("/").pop() ?? "";
      if (!keep.has(id)) await cache.delete(request);
    }
  },

  // Browsers can clear a site's storage to free space, as phones can clear an app's cache folder.
  async missing(trackIds) {
    const cache = await caches.open(CACHE);
    const kept = new Set((await cache.keys()).map((r) => new URL(r.url).pathname.split("/").pop() ?? ""));
    return trackIds.filter((id) => !kept.has(id));
  },

  async localUri(trackId) {
    const known = objectUrls.get(trackId);
    if (known) return known;
    const res = await (await caches.open(CACHE)).match(keyFor(trackId));
    if (!res) return null;
    const url = URL.createObjectURL(await res.blob());
    objectUrls.set(trackId, url);
    return url;
  },
};
