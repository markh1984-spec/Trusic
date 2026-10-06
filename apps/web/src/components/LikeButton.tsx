import { useNavigate } from "react-router";
import { useAuth } from "../auth";
import { useLibrary } from "../library";
import { Icon } from "./Icon";

export function LikeButton({ trackId, title, size = 18 }: { trackId: string; title: string; size?: number }) {
  const { me } = useAuth();
  const library = useLibrary();
  const navigate = useNavigate();
  const liked = library.isLiked(trackId);
  return (
    <button
      className={`icon-button like-button${liked ? " like-button--on" : ""}`}
      aria-pressed={liked}
      aria-label={liked ? `Remove ${title} from Liked songs` : `Add ${title} to Liked songs`}
      title={liked ? "Remove from Liked songs" : "Add to Liked songs"}
      onClick={(e) => {
        e.stopPropagation();
        if (!me) return navigate("/login");
        void library.toggleLike(trackId).catch(() => undefined);
      }}
    >
      <Icon name={liked ? "heartFilled" : "heart"} size={size} />
    </button>
  );
}
