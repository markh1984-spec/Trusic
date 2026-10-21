import type { PlaylistDetail } from "@trusic/client";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../api";
import { PlaylistCover } from "../components/Artwork";
import { ErrorNote, Loading } from "../components/Guards";
import { OpenedYourselfNote } from "../components/HumanOnlyToggle";
import { RadioButton } from "../components/RadioButton";
import { Icon } from "../components/Icon";
import { MoreMenuWithShare, ShareButton } from "../components/Share";
import { MoreMenu } from "../components/MoreMenu";
import { TrackList } from "../components/TrackList";
import { duration, plural } from "../format";
import { useAsync } from "../hooks";
import { useLibrary } from "../library";
import { usePlayTracks } from "../player";
import { usePageTitle } from "../share";
import { useToast } from "../toast";

export function PlaylistPage() {
  const { id = "" } = useParams();
  const { data, error, loading } = useAsync(() => api.playlist(id), [id]);
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const play = usePlayTracks();
  const library = useLibrary();
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => setPlaylist(data), [data]);
  usePageTitle(playlist?.name ?? null);

  if (error) return <ErrorNote message={error} />;
  if (loading || !playlist) return <Loading />;

  const tracks = playlist.entries.map((e) => e.track);

  /** Apply a change, then refresh the sidebar's playlist list too. */
  const apply = async (change: Promise<PlaylistDetail>) => {
    try {
      setPlaylist(await change);
      void library.refreshPlaylists();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't update the playlist.");
    }
  };

  const move = (from: number, to: number) => {
    const ids = playlist.entries.map((e) => e.entryId);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    void apply(api.reorderPlaylist(playlist.id, ids));
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${playlist.name}"? This can't be undone.`)) return;
    await api.deletePlaylist(playlist.id);
    await library.refreshPlaylists();
    toast("Playlist deleted");
    navigate("/library");
  };

  return (
    <>
      <section className="collection-hero">
        <div className="collection-hero__cover">
          <PlaylistCover urls={playlist.artworkUrls} title={playlist.name} />
        </div>
        <div>
          <p className="eyebrow">{playlist.isPublic ? "Public playlist" : "Private playlist"}</p>
          {editing ? (
            <PlaylistForm
              playlist={playlist}
              onCancel={() => setEditing(false)}
              onSave={async (input) => {
                await apply(api.updatePlaylist(playlist.id, input));
                setEditing(false);
              }}
            />
          ) : (
            <>
              <h1>{playlist.name}</h1>
              {playlist.description ? <p className="muted">{playlist.description}</p> : null}
              <p className="collection-hero__meta">
                <strong>{playlist.owner.displayName}</strong> · {plural(playlist.trackCount, "track")},{" "}
                {duration(playlist.durationMs)}
              </p>
            </>
          )}
        </div>
      </section>

      <div className="collection-actions">
        {tracks.length ? (
          <button
            className="play-button play-button--large"
            onClick={() => play(tracks, 0, playlist.name, "playlist")}
            aria-label={`Play ${playlist.name}`}
          >
            <Icon name="play" size={26} />
          </button>
        ) : null}
        {playlist.isPublic ? (
          <ShareButton
            target={{ kind: "playlist", key: playlist.id, title: `${playlist.name} · ${playlist.owner.displayName}` }}
          />
        ) : null}
        {tracks.length ? <RadioButton seed={{ type: "playlist", id: playlist.id }} name={playlist.name} /> : null}
        {playlist.isOwner && !editing ? (
          <>
            <button className="button button--ghost" onClick={() => setEditing(true)}>
              Edit details
            </button>
            <button className="button button--ghost" onClick={() => void remove()}>
              Delete
            </button>
          </>
        ) : null}
        {playlist.isPublic ? (
          <MoreMenuWithShare
            target={{ kind: "playlist", key: playlist.id, title: `${playlist.name} · ${playlist.owner.displayName}` }}
            label={playlist.name}
            items={playlist.isOwner ? [] : [{ label: "Report…", to: `/report/playlist/${playlist.id}` }]}
          />
        ) : (
          <MoreMenu
            label={playlist.name}
            items={playlist.isOwner ? [] : [{ label: "Report…", to: `/report/playlist/${playlist.id}` }]}
          />
        )}
      </div>

      <OpenedYourselfNote tracks={tracks} what="this playlist" />
      <TrackList
        tracks={tracks}
        keys={playlist.entries.map((e) => e.entryId)}
        label={playlist.name}
        source="playlist"
        empty={
          playlist.isOwner
            ? "This playlist is empty. Use the ⋯ menu on any track to add it here."
            : "This playlist is empty."
        }
        menuItems={
          playlist.isOwner
            ? (_track, i) => [
                {
                  label: "Remove from this playlist",
                  onSelect: () => void apply(api.removeFromPlaylist(playlist.id, playlist.entries[i]!.entryId)),
                },
              ]
            : undefined
        }
        rowActions={
          playlist.isOwner
            ? (track, i) => (
                <span className="reorder">
                  <button
                    className="icon-button"
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                    aria-label={`Move ${track.title} up`}
                  >
                    <Icon name="up" size={16} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={i === tracks.length - 1}
                    onClick={() => move(i, i + 1)}
                    aria-label={`Move ${track.title} down`}
                  >
                    <Icon name="down" size={16} />
                  </button>
                </span>
              )
            : undefined
        }
      />
    </>
  );
}

function PlaylistForm({
  playlist,
  onSave,
  onCancel,
}: {
  playlist: PlaylistDetail;
  onSave(input: { name: string; description: string; isPublic: boolean }): Promise<void>;
  onCancel(): void;
}) {
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description);
  const [isPublic, setIsPublic] = useState(playlist.isPublic);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSave({ name: name.trim(), description: description.trim(), isPublic });
  };

  return (
    <form className="form playlist-form" onSubmit={submit}>
      <label>
        Name
        <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Description
        <textarea rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="inline-check">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        Public: anyone with the link can see it
      </label>
      <div className="row">
        <button className="button">Save</button>
        <button type="button" className="button button--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
