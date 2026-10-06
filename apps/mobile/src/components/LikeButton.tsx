import { routes, useGo } from "../lib/navigation";
import { useAuth } from "../state/auth";
import { useLibrary } from "../state/library";
import { colors } from "../theme";
import { IconButton } from "./ui";

/** Heart button for a track; sends signed-out visitors to log in. */
export function LikeButton({ trackId, size = 24 }: { trackId: string; size?: number }) {
  const { me } = useAuth();
  const library = useLibrary();
  const go = useGo();
  const liked = library.isLiked(trackId);
  return (
    <IconButton
      icon={liked ? "heartFilled" : "heart"}
      label={liked ? "Remove from Liked songs" : "Add to Liked songs"}
      active={liked}
      size={size}
      color={colors.muted}
      onPress={() => {
        if (!me) return go(routes.account);
        void library.toggleLike(trackId).catch(() => undefined);
      }}
    />
  );
}
