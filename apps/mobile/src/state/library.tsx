import type { PlaylistSummary } from "@trusic/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useAuth } from "./auth";

interface LibraryState {
  isLiked(trackId: string): boolean;
  isFollowing(artistId: string): boolean;
  toggleLike(trackId: string): Promise<void>;
  toggleFollow(artistId: string): Promise<void>;
  playlists: PlaylistSummary[];
  refreshPlaylists(): Promise<void>;
  createPlaylist(name: string): Promise<string>;
  addToPlaylist(playlistId: string, trackIds: string[]): Promise<void>;
}

const LibraryContext = createContext<LibraryState | null>(null);

/** The signed-in listener's likes, follows and playlists, shared by every screen. */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const userId = me?.user.id;
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);

  const refreshPlaylists = useCallback(async () => {
    if (!userId) return;
    setPlaylists(await api.myPlaylists());
  }, [userId]);

  useEffect(() => {
    setLiked(new Set());
    setFollowed(new Set());
    setPlaylists([]);
    if (!userId) return;
    let cancelled = false;
    void Promise.all([api.library(), api.myPlaylists()])
      .then(([ids, mine]) => {
        if (cancelled) return;
        setLiked(new Set(ids.likedTrackIds));
        setFollowed(new Set(ids.followedArtistIds));
        setPlaylists(mine);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggleIn = (set: Set<string>, id: string, on: boolean) => {
    const copy = new Set(set);
    if (on) copy.add(id);
    else copy.delete(id);
    return copy;
  };

  const toggleLike = useCallback(
    async (trackId: string) => {
      const on = !liked.has(trackId);
      setLiked((s) => toggleIn(s, trackId, on));
      try {
        await (on ? api.like(trackId) : api.unlike(trackId));
      } catch (e) {
        setLiked((s) => toggleIn(s, trackId, !on));
        throw e;
      }
    },
    [liked],
  );

  const toggleFollow = useCallback(
    async (artistId: string) => {
      const on = !followed.has(artistId);
      setFollowed((s) => toggleIn(s, artistId, on));
      try {
        await (on ? api.follow(artistId) : api.unfollow(artistId));
      } catch (e) {
        setFollowed((s) => toggleIn(s, artistId, !on));
        throw e;
      }
    },
    [followed],
  );

  const value = useMemo<LibraryState>(
    () => ({
      isLiked: (id) => liked.has(id),
      isFollowing: (id) => followed.has(id),
      toggleLike,
      toggleFollow,
      playlists,
      refreshPlaylists,
      async createPlaylist(name) {
        const created = await api.createPlaylist({ name });
        await refreshPlaylists();
        return created.id;
      },
      async addToPlaylist(playlistId, trackIds) {
        await api.addToPlaylist(playlistId, trackIds);
        await refreshPlaylists();
      },
    }),
    [liked, followed, playlists, toggleLike, toggleFollow, refreshPlaylists],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryState {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside LibraryProvider");
  return ctx;
}
