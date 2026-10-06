import { useSearchParams } from "react-router";
import { api } from "../api";
import { ErrorNote, Loading } from "../components/Guards";
import { TrackList } from "../components/TrackList";
import { useAsync } from "../hooks";

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const { data, error, loading } = useAsync(() => api.tracks({ q, limit: 100 }), [q]);

  return (
    <section>
      <h1>{q ? `Results for “${q}”` : "Browse everything"}</h1>
      {error ? (
        <ErrorNote message={error} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <TrackList
          tracks={data?.tracks ?? []}
          empty={q ? "Nothing matched. Try an artist, title or genre." : undefined}
        />
      )}
    </section>
  );
}
