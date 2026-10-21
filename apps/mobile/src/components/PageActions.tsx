import type { RadioSeed, ReportTargetType } from "@trusic/client";
import { StyleSheet, View } from "react-native";
import { errorMessage } from "../lib/api";
import { routes, useGo } from "../lib/navigation";
import type { ShareTarget } from "../lib/share";
import { useShare } from "../lib/share-sheet";
import { usePlayer } from "../state/player";
import { useToast } from "../state/toast";
import { colors, space } from "../theme";
import { useMoreMenu, type ExtraAction, type MenuSheet } from "./TrackActions";
import { Button, IconButton } from "./ui";

export interface PageActionsOptions extends Omit<MenuSheet, "items"> {
  /** Offer radio from this track, artist or playlist. */
  radio?: RadioSeed | null;
  /** Offer sharing a link to it. Private playlists have none. */
  share?: ShareTarget | null;
  /** Offer reporting it. Not for your own things. */
  report?: { type: ReportTargetType; id: string } | null;
  /** The page's own choices, listed first in its ⋯ sheet, e.g. "Go to artist". */
  extra?: ExtraAction[];
}

export interface PageActions {
  startRadio: (() => void) | null;
  share: (() => void) | null;
  /** Open the page's ⋯ sheet, or null if it would be empty. */
  openMenu: (() => void) | null;
}

/** What a track, release, artist or playlist page offers: radio, sharing and reporting. */
export function usePageActions({ radio, share, report, extra = [], ...sheet }: PageActionsOptions): PageActions {
  const player = usePlayer();
  const toast = useToast();
  const shareLink = useShare();
  const go = useGo();
  const openMenu = useMoreMenu();

  const startRadio = radio
    ? () =>
        void player
          .startRadio(radio)
          .then((name) => toast(`Playing ${name}`))
          .catch((e: unknown) => toast(errorMessage(e, "Couldn't start the radio.")))
    : null;
  const shareIt = share ? () => void shareLink(share) : null;
  const items: ExtraAction[] = [
    ...extra,
    ...(startRadio ? [{ label: "Start radio", onSelect: startRadio }] : []),
    ...(shareIt ? [{ label: "Share…", onSelect: shareIt }] : []),
    ...(report ? [{ label: "Report…", onSelect: () => go(routes.report(report.type, report.id)) }] : []),
  ];
  return {
    startRadio,
    share: shareIt,
    openMenu: items.length ? () => openMenu({ ...sheet, items }) : null,
  };
}

/** Radio and Share, under a page's main buttons. */
export function PageButtons({ actions }: { actions: PageActions }) {
  if (!actions.startRadio && !actions.share) return null;
  return (
    <View style={styles.row}>
      {actions.startRadio ? (
        <Button small variant="ghost" icon="radio" title="Radio" onPress={actions.startRadio} />
      ) : null}
      {actions.share ? <Button small variant="ghost" icon="share" title="Share" onPress={actions.share} /> : null}
    </View>
  );
}

/** The page's ⋯ button. */
export function PageMenuButton({ actions, label }: { actions: PageActions; label: string }) {
  if (!actions.openMenu) return null;
  return <IconButton icon="more" label={`More options for ${label}`} onPress={actions.openMenu} color={colors.muted} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.md },
});
