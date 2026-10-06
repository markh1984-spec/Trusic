import type { TrackSummary } from "@trusic/client";
import { usePathname, useRouter } from "expo-router";
import { useCallback } from "react";
import { useAuth } from "../state/auth";
import { usePlayer } from "../state/player";
import { useToast } from "../state/toast";

/** Links to the app's screens. */
export const routes = {
  track: (id: string) => `/track/${id}`,
  release: (id: string) => `/release/${id}`,
  artist: (slug: string) => `/artist/${encodeURIComponent(slug)}`,
  playlist: (id: string) => `/playlist/${id}`,
  liked: "/liked",
  nowPlaying: "/now-playing",
  account: "/account",
} as const;

/**
 * Open a screen inside the current tab. From the full-screen Now Playing view,
 * close it first so the screen opens underneath, in the tab you came from.
 */
export function useGo() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (href: string) => {
      if (pathname === routes.nowPlaying && router.canGoBack()) router.back();
      router.push(href);
    },
    [router, pathname],
  );
}

/** Play a list of tracks, sending signed-out visitors to log in first. */
export function usePlayTracks() {
  const { me } = useAuth();
  const player = usePlayer();
  const router = useRouter();
  const toast = useToast();
  return useCallback(
    (tracks: TrackSummary[], startIndex: number, label?: string) => {
      if (!me) {
        toast("Log in to listen");
        router.navigate(routes.account);
        return;
      }
      player.playQueue(tracks, startIndex, label);
    },
    [me, player, router, toast],
  );
}
