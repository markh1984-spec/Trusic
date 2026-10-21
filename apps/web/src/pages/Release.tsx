import { Link, useParams } from "react-router";
import { api } from "../api";
import { Artwork } from "../components/Artwork";
import { releaseAiSummary, releaseYear, TYPE_NAMES } from "../components/Cards";
import { ErrorNote, Loading } from "../components/Guards";
import { OpenedYourselfNote } from "../components/HumanOnlyToggle";
import { Icon } from "../components/Icon";
import { MoreMenuWithShare, ShareButton } from "../components/Share";
import { TrackList } from "../components/TrackList";
import { duration, plural } from "../format";
import { useAsync } from "../hooks";
import { DownloadButton } from "../offline/DownloadButton";
import { usePlayTracks } from "../player";
import { usePageTitle } from "../share";

export function ReleasePage() {
  const { id = "" } = useParams();
  const { data: release, error, loading } = useAsync(() => api.release(id), [id]);
  const play = usePlayTracks();
  usePageTitle(release ? `${release.title} · ${TYPE_NAMES[release.type]} by ${release.artist.name}` : null);

  if (error) return <ErrorNote message={error} />;
  if (loading || !release) return <Loading />;

  const allHuman = release.trackCount > 0 && release.aiLabels.human === release.trackCount;

  return (
    <>
      <section className="collection-hero">
        <Artwork url={release.artworkUrl} title={release.title} label={allHuman ? "human" : undefined} size={200} />
        <div>
          <p className="eyebrow">{TYPE_NAMES[release.type]}</p>
          <h1>{release.title}</h1>
          <p className="collection-hero__meta">
            <Link to={`/artist/${release.artist.slug}`}>
              <strong>{release.artist.name}</strong>
            </Link>
            {releaseYear(release) ? <span> · {releaseYear(release)}</span> : null}
            <span>
              {" "}
              · {plural(release.trackCount, "track")}, {duration(release.durationMs)}
            </span>
          </p>
          <p className={allHuman ? "text-human small" : "muted small"}>
            {allHuman ? "Every track is human-made." : releaseAiSummary(release)}
          </p>
        </div>
      </section>
      <div className="collection-actions">
        {release.tracks.length ? (
          <button
            className="play-button play-button--large"
            onClick={() => play(release.tracks, 0, release.title, "release")}
            aria-label={`Play ${release.title}`}
          >
            <Icon name="play" size={26} />
          </button>
        ) : null}
        <ShareButton
          target={{ kind: "release", key: release.id, title: `${release.title} · ${release.artist.name}` }}
        />
        {release.isOwner ? (
          <Link to={`/studio/release/${release.id}`} className="button button--ghost">
            Edit release
          </Link>
        ) : null}
        <DownloadButton
          collection={{
            type: "release",
            id: release.id,
            title: release.title,
            subtitle: release.artist.name,
            artworkUrl: release.artworkUrl,
            trackIds: release.tracks.map((t) => t.id),
          }}
        />
        <MoreMenuWithShare
          target={{ kind: "release", key: release.id, title: `${release.title} · ${release.artist.name}` }}
          label={release.title}
          items={release.isOwner ? [] : [{ label: "Report…", to: `/report/release/${release.id}` }]}
        />
      </div>
      <OpenedYourselfNote tracks={release.tracks} what="this release" />
      <TrackList tracks={release.tracks} label={release.title} source="release" variant="release" showArtist={false} />
    </>
  );
}
