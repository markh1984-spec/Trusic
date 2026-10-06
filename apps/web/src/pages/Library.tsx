import { Link, useSearchParams } from "react-router";
import { api } from "../api";
import { ArtistCard, CardGrid, PlaylistCard } from "../components/Cards";
import { ErrorNote, Loading, RequireAuth } from "../components/Guards";
import { Icon } from "../components/Icon";
import { TrackList } from "../components/TrackList";
import { plural } from "../format";
import { useAsync } from "../hooks";
import { useLibrary } from "../library";
import { usePlayTracks } from "../player";

const TABS = [
  { id: "playlists", label: "Playlists" },
  { id: "artists", label: "Artists" },
  { id: "history", label: "Recently played" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function LibraryPage() {
  return (
    <RequireAuth>
      <Library />
    </RequireAuth>
  );
}

function Library() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((t) => t.id === params.get("tab")) ? (params.get("tab") as Tab) : "playlists";

  return (
    <>
      <h1>Your library</h1>
      <div className="chips" role="tablist" aria-label="Library sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`chip${tab === t.id ? " chip--active" : ""}`}
            onClick={() => setParams(t.id === "playlists" ? {} : { tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === "playlists" ? <Playlists /> : tab === "artists" ? <Artists /> : <History />}
      </div>
    </>
  );
}

function Playlists() {
  const library = useLibrary();
  return (
    <CardGrid>
      <Link to="/liked" className="tile tile--liked">
        <span className="liked-cover" aria-hidden>
          <Icon name="heartFilled" size={48} />
        </span>
        <span className="tile__title">Liked songs</span>
        <span className="tile__sub">Your favourites</span>
      </Link>
      {library.playlists.map((p) => (
        <PlaylistCard key={p.id} playlist={p} />
      ))}
    </CardGrid>
  );
}

function Artists() {
  const { data, error, loading } = useAsync(() => api.follows(), []);
  if (error) return <ErrorNote message={error} />;
  if (loading || !data) return <Loading />;
  if (data.length === 0) return <p className="muted">Follow artists from their pages and they'll show up here.</p>;
  return (
    <CardGrid>
      {data.map((a) => (
        <ArtistCard key={a.id} artist={a} />
      ))}
    </CardGrid>
  );
}

function History() {
  const { data, error, loading } = useAsync(() => api.history(), []);
  if (error) return <ErrorNote message={error} />;
  if (loading || !data) return <Loading />;
  return (
    <TrackList
      tracks={data.map((h) => h.track)}
      label="Recently played"
      empty="Nothing yet. Tracks you play will show up here."
    />
  );
}

export function LikedPage() {
  return (
    <RequireAuth>
      <Liked />
    </RequireAuth>
  );
}

function Liked() {
  const library = useLibrary();
  const { data, error, loading } = useAsync(() => api.likes(), []);
  const play = usePlayTracks();
  if (error) return <ErrorNote message={error} />;
  if (loading || !data) return <Loading />;
  // Hide tracks unliked on this page without refetching.
  const tracks = data.map((l) => l.track).filter((t) => library.isLiked(t.id));

  return (
    <>
      <section className="collection-hero">
        <span className="liked-cover liked-cover--large" aria-hidden>
          <Icon name="heartFilled" size={72} />
        </span>
        <div>
          <p className="eyebrow">Playlist</p>
          <h1>Liked songs</h1>
          <p className="collection-hero__meta">{plural(tracks.length, "track")}</p>
        </div>
      </section>
      <div className="collection-actions">
        {tracks.length ? (
          <button
            className="play-button play-button--large"
            onClick={() => play(tracks, 0, "Liked songs")}
            aria-label="Play liked songs"
          >
            <Icon name="play" size={26} />
          </button>
        ) : null}
      </div>
      <TrackList tracks={tracks} label="Liked songs" empty="Tap the heart on any track to save it here." />
    </>
  );
}
