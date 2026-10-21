import { useCallback } from "react";
import { Platform, Share } from "react-native";
import { useToast } from "../state/toast";
import { api } from "./api";
import { SITE_URL, SITE_URL_CONFIGURED } from "./config";
import { chooseSite, shareContent, shareUrl, type ShareTarget } from "./share";

let reported: Promise<string | null> | null = null;

/** The website's address, for share links and pages the app opens there. Asks the server once. */
export async function siteAddress(): Promise<string> {
  if (SITE_URL_CONFIGURED) return chooseSite({ configured: SITE_URL, reported: null, fallback: SITE_URL });
  reported ??= api.siteInfo().then(
    (site) => site.url,
    () => {
      // Try again next time (it fails without signal).
      reported = null;
      return null;
    },
  );
  return chooseSite({ configured: null, reported: await reported, fallback: SITE_URL });
}

async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

/** Open the phone's share sheet with a link to `target` on the website. */
export function useShare() {
  const toast = useToast();
  return useCallback(
    async (target: ShareTarget) => {
      const url = shareUrl(await siteAddress(), target);
      try {
        await Share.share(shareContent(Platform.OS, target, url), {
          dialogTitle: `Share ${target.title}`,
          subject: target.title,
        });
      } catch (e) {
        // Closing the share sheet isn't a problem. A browser without one copies the link instead.
        if (e instanceof Error && e.name === "AbortError") return;
        if (Platform.OS === "web" && (await copyLink(url))) toast("Link copied");
        else toast(`Couldn't open sharing. The link is ${url}`);
      }
    },
    [toast],
  );
}
