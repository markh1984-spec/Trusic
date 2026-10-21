/**
 * Where the phone keeps offline things, using Expo's file system in the app's private storage, which other apps
 * and the Files app can't see:
 *
 *   documents/offline/<name>.json        small documents: the list of downloads, queued plays, settings
 *   cache/offline-audio/<id>.<ext>       downloaded tracks, named by track id
 *
 * Downloaded tracks are in the cache folder so they're left out of iCloud and Android backups: Apple asks apps
 * not to back up files that can be downloaded again, and Expo's file system has no way to mark a file in the
 * documents folder as "don't back up". The catch is that a phone very short of space may clear the cache folder.
 * The download manager notices at the next check-in (see `missing`) and downloads those tracks again.
 *
 * The browser build has its own version of this file (offline-storage.web.ts).
 */
import { ApiError } from "@trusic/client";
import type { OfflineFiles } from "@trusic/player";
import { Directory, File, Paths } from "expo-file-system";
import { api } from "./api";
import { AUDIO_EXTENSIONS, audioExtension, trackIdOfFile } from "./offline";

const root = () => new Directory(Paths.document, "offline");
const audioDir = () => new Directory(Paths.cache, "offline-audio");

/** Where earlier versions of the app kept downloads, which iCloud backed up. Deleted once; they download again. */
function removeOldAudio() {
  try {
    const old = new Directory(root(), "audio");
    if (old.exists) old.delete();
  } catch {
    // Not worth stopping for: the folder is tried again next time the app opens.
  }
}

function ensure(dir: Directory) {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
}

export interface JsonDocument<T> {
  load(): Promise<T | null>;
  /** Null deletes it. */
  save(value: T | null): Promise<void>;
}

/** A small JSON document kept between launches. */
export function jsonDocument<T>(name: string): JsonDocument<T> {
  const file = () => new File(root(), `${name}.json`);
  return {
    async load() {
      try {
        const f = file();
        return f.exists ? (JSON.parse(await f.text()) as T) : null;
      } catch {
        return null;
      }
    },
    async save(value) {
      const f = file();
      if (value === null) {
        if (f.exists) f.delete();
        return;
      }
      ensure(root());
      f.create({ intermediates: true, overwrite: true });
      f.write(JSON.stringify(value));
    },
  };
}

/** The downloaded copy of a track, if there is one. */
function findAudio(trackId: string): File | null {
  for (const ext of [...AUDIO_EXTENSIONS, "audio"]) {
    const f = new File(audioDir(), `${trackId}.${ext}`);
    if (f.exists) return f;
  }
  return null;
}

export const audioFiles: OfflineFiles & { localUri(trackId: string): Promise<string | null> } = {
  async download(track, url, mimeType) {
    ensure(audioDir());
    const partial = new File(audioDir(), `${track.id}.part`);
    if (partial.exists) partial.delete();
    try {
      await File.downloadFileAsync(api.resolveUrl(url), partial, { idempotent: true });
    } catch (error) {
      if (partial.exists) partial.delete();
      // A refusal from the server (an expired link, say) isn't the same as having no signal.
      const status = /\b([45]\d\d)\b/.exec(error instanceof Error ? error.message : "")?.[1];
      throw status ? new ApiError(Number(status), "Couldn't download this track.") : error;
    }
    findAudio(track.id)?.delete();
    const target = new File(audioDir(), `${track.id}.${audioExtension(mimeType)}`);
    partial.move(target, { overwrite: true });
    return new File(target.uri).size;
  },

  async remove(trackIds) {
    for (const id of trackIds) findAudio(id)?.delete();
  },

  async removeAll() {
    const dir = audioDir();
    if (dir.exists) dir.delete();
  },

  async prune(keep) {
    removeOldAudio();
    const dir = audioDir();
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      const id = trackIdOfFile(entry.name);
      if (!id || !keep.has(id)) entry.delete();
    }
  },

  async missing(trackIds) {
    return trackIds.filter((id) => !findAudio(id));
  },

  async localUri(trackId) {
    return findAudio(trackId)?.uri ?? null;
  },
};
