import type { HomeShelf, PlaySource, RecommendedArtist, RecommendedTrack } from "@trusic/client";
import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { usePlayer, usePlayTracks } from "../player";
import { AiBadge } from "./AiBadge";
import { Artwork } from "./Artwork";
import { ReleaseCard } from "./Cards";
import { Icon } from "./Icon";

/** "Why am I seeing this?": every recommendation explains itself. */
export function Why({ text }: { text: string }) {
  return (
    <details className="why">
      <summary>
        <Icon name="info" size={16} />
        Why am I seeing this?
      </summary>
      <p>{text}</p>
    </details>
  );
}

/** A titled row of tiles that scrolls sideways, with its explanation. */
function Shelf({ title, why, children }: { title: string; why: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="shelf" aria-labelledby={id}>
      <div className="shelf__head">
        <h2 id={id}>{title}</h2>
        <Why text={why} />
      </div>
      <ul className="shelf__row">{children}</ul>
    </section>
  );
}

function TrackTile({ item, onPlay }: { item: RecommendedTrack; onPlay(): void }) {
  const { track, reason } = item;
  const { current, playing, toggle } = usePlayer();
  const isCurrent = current?.id === track.id;
  return (
    <li className={`shelf-tile${isCurrent ? " shelf-tile--current" : ""}`}>
      <span className="shelf-tile__art">
        <Artwork url={track.artworkUrl} title={track.title} label={track.aiLabel} size="fill" />
        <span className="shelf-tile__label">
          <AiBadge score={track.aiScore} compact />
        </span>
        <button
          className="play-button shelf-tile__play"
          onClick={() => (isCurrent ? toggle() : onPlay())}
          aria-label={isCurrent && playing ? `Pause ${track.title}` : `Play ${track.title}`}
        >
          <Icon name={isCurrent && playing ? "pause" : "play"} size={20} />
        </button>
      </span>
      <Link to={`/track/${track.id}`} className="shelf-tile__title">
        {track.title}
      </Link>
      <Link to={`/artist/${track.artist.slug}`} className="shelf-tile__sub">
        {track.artist.name}
      </Link>
      <span className="shelf-tile__reason">{reason}</span>
    </li>
  );
}

export function TrackShelf({
  title,
  why,
  items,
  source = "recommendations",
}: {
  title: string;
  why: string;
  items: RecommendedTrack[];
  source?: PlaySource;
}) {
  const play = usePlayTracks();
  const tracks = items.map((i) => i.track);
  return (
    <Shelf title={title} why={why}>
      {items.map((item, i) => (
        <TrackTile key={item.track.id} item={item} onPlay={() => play(tracks, i, title, source)} />
      ))}
    </Shelf>
  );
}

function ArtistTile({ item }: { item: RecommendedArtist }) {
  const { artist, reason, tracks, humanMadeTracks } = item;
  return (
    <li className="shelf-tile shelf-tile--artist">
      <Link to={`/artist/${artist.slug}`} className="shelf-tile__art" aria-label={artist.name}>
        <Artwork url={artist.imageUrl} title={artist.name} size="fill" round />
      </Link>
      <Link to={`/artist/${artist.slug}`} className="shelf-tile__title">
        {artist.name}
      </Link>
      <span className="shelf-tile__sub">
        {humanMadeTracks} of {tracks} tracks human-made
      </span>
      <span className="shelf-tile__reason">{reason}</span>
    </li>
  );
}

export function ArtistShelf({ title, why, items }: { title: string; why: string; items: RecommendedArtist[] }) {
  return (
    <Shelf title={title} why={why}>
      {items.map((item) => (
        <ArtistTile key={item.artist.id} item={item} />
      ))}
    </Shelf>
  );
}

/** Any home-page shelf. */
export function HomeShelfView({ shelf }: { shelf: HomeShelf }) {
  if (shelf.kind === "tracks") return <TrackShelf title={shelf.title} why={shelf.why} items={shelf.tracks} />;
  if (shelf.kind === "artists") return <ArtistShelf title={shelf.title} why={shelf.why} items={shelf.artists} />;
  return (
    <Shelf title={shelf.title} why={shelf.why}>
      {shelf.releases.map((r) => (
        <li key={r.id} className="shelf-tile shelf-tile--release">
          <ReleaseCard release={r} showArtist />
        </li>
      ))}
    </Shelf>
  );
}
