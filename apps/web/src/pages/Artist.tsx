import { aiLabel } from "@trusic/core";
import { useParams } from "react-router";
import { api } from "../api";
import { ErrorNote, Loading } from "../components/Guards";
import { TrackList } from "../components/TrackList";
import { useAsync } from "../hooks";
import { usePlayTracks } from "../player";
import { Icon } from "../components/Icon";

export function ArtistPage() {
  const { slug = "" } = useParams();
  const { data, error, loading } = useAsync(() => api.artist(slug), [slug]);
  const play = usePlayTracks();

  if (error) return <ErrorNote message={error} />;
  if (loading || !data) return <Loading />;
  const { artist, tracks } = data;
  const human = tracks.filter((t) => aiLabel(t.aiScore) === "human").length;

  return (
    <>
      <section className="profile">
        <div className="profile__avatar" aria-hidden>
          {artist.name.slice(0, 1)}
        </div>
        <div>
          <p className="eyebrow">Artist</p>
          <h1>{artist.name}</h1>
          <p className="muted">
            {tracks.length} tracks · {human} human-made
          </p>
          {artist.bio ? <p className="profile__bio">{artist.bio}</p> : null}
        </div>
      </section>
      {tracks.length ? (
        <button
          className="play-button play-button--large"
          onClick={() => play(tracks, 0)}
          aria-label={`Play ${artist.name}`}
        >
          <Icon name="play" size={26} />
        </button>
      ) : null}
      <TrackList tracks={tracks} showArtist={false} />
    </>
  );
}
