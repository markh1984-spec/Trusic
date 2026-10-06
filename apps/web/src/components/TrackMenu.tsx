import type { TrackSummary } from "@trusic/client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth";
import { useLibrary } from "../library";
import { usePlayer } from "../player";
import { useToast } from "../toast";
import { Icon } from "./Icon";

export interface ExtraMenuItem {
  label: string;
  onSelect(): void;
}

/** The "⋯" menu on a track: queue it, add it to a playlist, like it, go to its artist. */
export function TrackMenu({ track, extraItems = [] }: { track: TrackSummary; extraItems?: ExtraMenuItem[] }) {
  const { me } = useAuth();
  const player = usePlayer();
  const library = useLibrary();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "playlists">("main");
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setView("main");
    setNewName("");
  };

  /** Run an action that needs an account, sending signed-out visitors to log in. */
  const signedIn = (action: () => void) => () => {
    if (!me) return navigate("/login");
    action();
    close();
  };

  const addTo = async (playlistId: string, name: string) => {
    close();
    try {
      await library.addToPlaylist(playlistId, [track.id]);
      toast(`Added to ${name}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't add it.");
    }
  };

  const createAndAdd = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const id = await library.createPlaylist(name);
      await addTo(id, name);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't create the playlist.");
    }
  };

  const liked = library.isLiked(track.id);

  return (
    <div className="menu" ref={ref}>
      <button
        className="icon-button"
        aria-label={`More options for ${track.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
          setView("main");
        }}
      >
        <Icon name="more" />
      </button>
      {open ? (
        <div className="menu__popover" role="menu">
          {view === "main" ? (
            <>
              <button role="menuitem" onClick={signedIn(() => (player.playNext(track), toast("Playing next")))}>
                Play next
              </button>
              <button role="menuitem" onClick={signedIn(() => (player.addToQueue(track), toast("Added to queue")))}>
                Add to queue
              </button>
              <button role="menuitem" onClick={() => (me ? setView("playlists") : navigate("/login"))}>
                Add to playlist…
              </button>
              <button role="menuitem" onClick={signedIn(() => void library.toggleLike(track.id))}>
                {liked ? "Remove from Liked songs" : "Add to Liked songs"}
              </button>
              <hr />
              <button role="menuitem" onClick={() => (close(), navigate(`/artist/${track.artist.slug}`))}>
                Go to artist
              </button>
              {track.release ? (
                <button role="menuitem" onClick={() => (close(), navigate(`/release/${track.release!.id}`))}>
                  Go to {track.release.title}
                </button>
              ) : null}
              <button role="menuitem" onClick={() => (close(), navigate(`/track/${track.id}`))}>
                AI transparency
              </button>
              {extraItems.length ? <hr /> : null}
              {extraItems.map((item) => (
                <button key={item.label} role="menuitem" onClick={() => (close(), item.onSelect())}>
                  {item.label}
                </button>
              ))}
            </>
          ) : (
            <>
              <button className="menu__back" onClick={() => setView("main")}>
                <Icon name="back" size={16} /> Add to playlist
              </button>
              <form className="menu__new" onSubmit={createAndAdd}>
                <input
                  autoFocus
                  placeholder="New playlist name"
                  value={newName}
                  maxLength={100}
                  onChange={(e) => setNewName(e.target.value)}
                  aria-label="New playlist name"
                />
                <button className="icon-button" aria-label="Create playlist" disabled={!newName.trim()}>
                  <Icon name="plus" size={18} />
                </button>
              </form>
              <div className="menu__scroll">
                {library.playlists.map((p) => (
                  <button key={p.id} role="menuitem" onClick={() => void addTo(p.id, p.name)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
