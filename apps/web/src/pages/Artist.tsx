import { aiLabel } from "@trusic/core";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth";
import { Artwork } from "../components/Artwork";
import { CardGrid, ReleaseCard } from "../components/Cards";
import { ErrorNote, Loading } from "../components/Guards";
import { OpenedYourselfNote } from "../components/HumanOnlyToggle";
import { Icon } from "../components/Icon";
import { RadioButton } from "../components/RadioButton";
import { MoreMenuWithShare, ShareButton } from "../components/Share";
import { ArtistShelf } from "../components/Shelves";
import { TrackList } from "../components/TrackList";
import { plural } from "../format";
import { useAsync } from "../hooks";
import { useHumanOnly } from "../human-only";
import { useLibrary } from "../library";
import { usePlayTracks } from "../player";
import { usePageTitle } from "../share";

export function ArtistPage() {
  const { slug = "" } = useParams();
  const { data, error, loading } = useAsync(() => api.artist(slug), [slug]);
  const { me } = useAuth();
  const library = useLibrary();
  const play = usePlayTracks();
  usePageTitle(data?.artist.name ?? null);

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
            onClick={() => play(tracks, 0, artist.name, "artist")}
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
        {tracks.length ? <RadioButton seed={{ type: "artist", id: artist.id }} name={artist.name} /> : null}
        {data.isOwner ? (
          <Link to={`/studio/artist/${artist.id}`} className="button button--ghost">
            <Icon name="chart" size={18} /> Your stats
          </Link>
        ) : null}
        <ShareButton target={{ kind: "artist", key: artist.slug, title: artist.name }} />
        <MoreMenuWithShare
          target={{ kind: "artist", key: artist.slug, title: artist.name }}
          label={artist.name}
          items={data.isOwner ? [] : [{ label: "Report…", to: `/report/artist/${artist.id}` }]}
        />
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
        <OpenedYourselfNote tracks={tracks} what="this artist's page" />
        <TrackList tracks={tracks} showArtist={false} label={artist.name} source="artist" />
      </section>

      <FansAlsoLike artistId={artist.id} />
    </>
  );
}

/** Artists streamed and liked by the same people. */
function FansAlsoLike({ artistId }: { artistId: string }) {
  const { humanOnly } = useHumanOnly();
  const { data } = useAsync(() => api.similarArtists(artistId, { humanOnly }), [artistId, humanOnly]);
  if (!data?.artists.length) return null;
  return <ArtistShelf title="Fans also like" why={data.why} items={data.artists} />;
}
