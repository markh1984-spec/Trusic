import { AI_LABELS } from "@trusic/core";
import { useSearchParams } from "react-router";
import { api } from "../api";
import { ErrorNote, Loading } from "../components/Guards";
import { TrackList } from "../components/TrackList";
import { useAsync } from "../hooks";
import { useHumanOnly } from "../human-only";

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const { humanOnly, setHumanOnly } = useHumanOnly();
  const { data, error, loading } = useAsync(() => api.tracks({ q, limit: 100, humanOnly }), [q, humanOnly]);

  return (
    <section>
      <h1>{q ? `Results for “${q}”` : "Browse everything"}</h1>
      {humanOnly ? (
        <p className="muted small">
          {AI_LABELS.human.name} only is on, so tracks labelled {AI_LABELS.ai_assisted.name} and{" "}
          {AI_LABELS.ai_generated.name} aren't shown.{" "}
          <button className="link-button" onClick={() => void setHumanOnly(false)}>
            Show everything
          </button>
        </p>
      ) : null}
      {error ? (
        <ErrorNote message={error} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <TrackList
          tracks={data?.tracks ?? []}
          label={q ? `“${q}”` : "Search"}
          source="search"
          empty={q ? "Nothing matched. Try an artist, title or genre." : undefined}
        />
      )}
    </section>
  );
}
