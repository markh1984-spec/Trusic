import { aiLabel } from "@trusic/core";
import { useParams } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { Artwork } from "../components/Artwork";
import { CardGrid, ReleaseCard } from "../components/Cards";
import { ErrorNote, Loading } from "../components/Guards";
import { Icon } from "../components/Icon";
import { TrackList } from "../components/TrackList";
import { plural } from "../format";
import { useAsync } from "../hooks";
import { useLibrary } from "../library";
import { usePlayTracks } from "../player";

export function ArtistPage() {
  const { slug = "" } = useParams();
  const { data, error, loading } = useAsync(() => api.artist(slug), [slug]);
  const { me } = useAuth();
  const library = useLibrary();
  const play = usePlayTracks();

  if (error) return <ErrorNote message={error} />;
  if (loading || !data) return <Loading />;
  const { artist, tracks, releases } = data;
  const human = tracks.filter((t) => aiLabel(t.aiScore) === "human").length;
  const following = library.isFollowing(artist.id);
  // Keep the count in step when the visitor follows or unfollows on this page.
  const followers = data.followers - (data.isFollowing ? 1 : 0) + (following ? 1 : 0);

  return (
    <>
      <section className="profile">
        <Artwork url={artist.imageUrl} title={artist.name} size={180} round />
        <div>
          <p className="eyebrow">Artist</p>
          <h1>{artist.name}</h1>
          <p className="muted">
            {plural(followers, "follower")} · {plural(tracks.length, "track")} · {human} human-made
          </p>
          {artist.bio ? <p className="profile__bio">{artist.bio}</p> : null}
        </div>
      </section>
      <div className="collection-actions">
        {tracks.length ? (
          <button
            className="play-button play-button--large"
            onClick={() => play(tracks, 0, artist.name)}
            aria-label={`Play ${artist.name}`}
          >
            <Icon name="play" size={26} />
          </button>
        ) : null}
        {me && !data.isOwner ? (
          <button
            className={`button ${following ? "button--ghost" : ""}`}
            aria-pressed={following}
            onClick={() => void library.toggleFollow(artist.id).catch(() => undefined)}
          >
            {following ? "Following" : "Follow"}
          </button>
        ) : null}
      </div>

      {releases.length ? (
        <section>
          <h2>Discography</h2>
          <CardGrid>
            {releases.map((r) => (
              <ReleaseCard key={r.id} release={r} />
            ))}
          </CardGrid>
        </section>
      ) : null}

      <section>
        <h2>Tracks</h2>
        <TrackList tracks={tracks} showArtist={false} label={artist.name} />
      </section>
    </>
  );
}
