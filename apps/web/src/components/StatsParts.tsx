import {
  PLAY_SOURCE_NAMES,
  type ArtistMoney,
  type ListeningStats,
  type StatsPoint,
  type StatsRange,
  type StatsRole,
} from "@trusic/client";
import { AI_LABELS } from "@trusic/core";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { money, periodName } from "../format";
import { BarList, TimeChart, type ChartPoint } from "./Charts";

export const RANGES: { value: StatsRange; label: string; previous: string }[] = [
  { value: "7d", label: "Last 7 days", previous: "the 7 days before" },
  { value: "28d", label: "Last 28 days", previous: "the 28 days before" },
  { value: "365d", label: "Last 365 days", previous: "the year before" },
];

/** The chosen range, kept in the address so it survives a reload and can be shared. */
export function useRange(): [StatsRange, (range: StatsRange) => void] {
  const [params, setParams] = useSearchParams();
  const range = RANGES.find((r) => r.value === params.get("range"))?.value ?? "28d";
  return [range, (value) => setParams(value === "28d" ? {} : { range: value }, { replace: true })];
}

export function RangePicker({ value, onChange }: { value: StatsRange; onChange(range: StatsRange): void }) {
  return (
    <div className="chips" role="radiogroup" aria-label="Time range">
      {RANGES.map((r) => (
        <button
          key={r.value}
          role="radio"
          aria-checked={value === r.value}
          className={`chip${value === r.value ? " chip--active" : ""}`}
          onClick={() => onChange(r.value)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export const ROLE_NOTES: Record<StatsRole, string> = {
  owner: "Only you, and band members in your tracks' splits, can see these stats. Money shows only your own share.",
  member:
    "You're in this artist's band splits, so you see all of its listening. Money shows only your own share of the tracks you're paid for.",
  admin: "You're looking as a Trusic admin. Money shows only what you're paid yourself.",
};

/** How much a running total (like followers) went up or down over the range. */
export function netChange(change: number): { text: string; className: string } {
  if (change === 0) return { text: "No change overall", className: "" };
  return change > 0
    ? { text: `▲ ${change.toLocaleString("en-GB")} more overall`, className: "delta--up" }
    : { text: `▼ ${Math.abs(change).toLocaleString("en-GB")} fewer overall`, className: "delta--down" };
}

/** A headline number, compared with the same length of time just before (or given its own `change`). */
export function StatTile({
  label,
  value,
  previous,
  range,
  note,
  change,
}: {
  label: string;
  value: number;
  previous?: number;
  range: StatsRange;
  note?: string;
  change?: { text: string; className: string };
}) {
  const before = RANGES.find((r) => r.value === range)!.previous;
  let delta: { text: string; className: string } | null = change ?? null;
  if (previous !== undefined) {
    if (previous === 0) delta = value > 0 ? { text: `New: none in ${before}`, className: "delta--up" } : null;
    else {
      const change = Math.round(((value - previous) / previous) * 100);
      delta =
        change === 0
          ? { text: `Same as ${before}`, className: "" }
          : {
              text: `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% on ${before}`,
              className: change > 0 ? "delta--up" : "delta--down",
            };
    }
  }
  return (
    <div className="stat stat-tile">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value.toLocaleString("en-GB")}</span>
      {delta ? <span className={`delta stat-tile__delta ${delta.className}`}>{delta.text}</span> : null}
      {note ? <span className="muted small">{note}</span> : null}
    </div>
  );
}

const dayLong = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
const dayShort = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** "Oct ’26" for "2026-10". */
const monthShort = (period: string) => {
  const month = new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return `${month} ’${period.slice(2, 4)}`;
};

type Metric = "streams" | "listeners" | "followers" | "likes";

const METRICS: Record<Metric, { name: string; unit: string; kind: "columns" | "line" }> = {
  streams: { name: "Streams", unit: "streams", kind: "columns" },
  listeners: { name: "Listeners", unit: "listeners", kind: "columns" },
  followers: { name: "Followers", unit: "followers", kind: "line" },
  likes: { name: "New likes", unit: "new likes", kind: "columns" },
};

/** "3 followed, 1 unfollowed", for the follower chart's tooltips and table. */
const followChanges = (p: StatsPoint) =>
  p.followersGained || p.followersLost
    ? ` · ${p.followersGained.toLocaleString("en-GB")} followed, ${p.followersLost.toLocaleString("en-GB")} unfollowed`
    : "";

function chartPoints(stats: ListeningStats, metric: Metric): ChartPoint[] {
  const last = stats.series.length - 1;
  return stats.series.map((p: StatsPoint, i) => ({
    short: dayShort(p.start),
    label:
      (stats.bucket === "day" ? dayLong(p.start) : `Week from ${dayLong(p.start)}`) +
      (i === last ? " (so far)" : "") +
      (metric === "followers" ? followChanges(p) : ""),
    value: p[metric],
  }));
}

/** One chart with a choice of what it shows. Followers are for artists only. */
export function ListeningChart({ stats, withFollowers }: { stats: ListeningStats; withFollowers: boolean }) {
  const [metric, setMetric] = useState<Metric>("streams");
  const choices = (Object.keys(METRICS) as Metric[]).filter((m) => withFollowers || m !== "followers");
  const per = stats.bucket === "day" ? "day" : "week";
  const m = METRICS[metric];
  const title = m.kind === "line" ? `${m.name} at the end of each ${per}` : `${m.name} per ${per}`;
  return (
    <section className="card">
      <div className="section-head">
        <h2>{title}</h2>
        <div className="chips" role="radiogroup" aria-label="What the chart shows">
          {choices.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={metric === c}
              className={`chip${metric === c ? " chip--active" : ""}`}
              onClick={() => setMetric(c)}
            >
              {METRICS[c].name}
            </button>
          ))}
        </div>
      </div>
      <TimeChart points={chartPoints(stats, metric)} title={title} kind={m.kind} />
      <p className="muted small">
        A stream is a play of 30 seconds or more by a subscriber: exactly what Trusic pays on. Listeners are different
        subscribers who streamed at least once. Days run midnight to midnight UTC (UK winter time), like the payout
        months.
        {metric === "followers"
          ? ` Followers is everyone following at the end of each ${per}: new follows less unfollows. Point at a ${per} to see both.`
          : ""}
      </p>
    </section>
  );
}

export function SourcesCard({ sources }: { sources: ListeningStats["sources"] }) {
  return (
    <section className="card">
      <h2>Where listeners found you</h2>
      {sources.length === 0 ? (
        <p className="muted">No streams in this time yet.</p>
      ) : (
        <BarList
          items={sources.map((s) => ({
            key: s.source ?? "unknown",
            label: s.source ? PLAY_SOURCE_NAMES[s.source] : "Not recorded (older apps)",
            value: s.streams,
          }))}
        />
      )}
      <p className="muted small">Streams by where the listener pressed play.</p>
    </section>
  );
}

/** The viewer's own money from these tracks, month by month, newest first. */
export function MoneyCard({ data, single = false }: { data: ArtistMoney; single?: boolean }) {
  const [all, setAll] = useState(false);
  const months = all ? data.months : data.months.slice(0, 6);
  const fmt = (n: number) => money(n, data.currency);
  return (
    <section className="card">
      <h2>{single ? "Your money from this track" : "Your money"}</h2>
      {data.months.length === 0 ? (
        <p className="muted">
          Nothing yet. Money shows up here after each monthly payout run, once{" "}
          {single ? "this track has" : "your tracks have"} had streams.
        </p>
      ) : (
        <>
          <TimeChart
            title="Your money per month"
            points={[...data.months].reverse().map((m) => ({
              short: monthShort(m.period),
              label: `${periodName(m.period)}${m.finalised ? "" : " (not finalised yet)"}`,
              value: m.amount,
            }))}
            format={fmt}
            axisFormat={(n) => money(n, data.currency).replace(/\.00$/, "")}
          />
          <table className="table money-table">
            <thead>
              <tr>
                <th>Month</th>
                {single ? null : <th>Track</th>}
                <th className="num">Streams paid</th>
                <th className="num">Your money</th>
              </tr>
            </thead>
            {months.map((m) => (
              <tbody key={m.period}>
                {m.tracks.map((t, i) => (
                  <tr key={t.trackId}>
                    {i === 0 ? (
                      <th
                        rowSpan={m.tracks.length + (!single && m.tracks.length > 1 ? 1 : 0)}
                        scope="rowgroup"
                        className="money-table__month"
                      >
                        {periodName(m.period)}
                        <span className={`status ${m.finalised ? "status--ok" : ""}`}>
                          {m.finalised ? "Finalised" : "Not finalised yet"}
                        </span>
                      </th>
                    ) : null}
                    {single ? null : <td>{t.title}</td>}
                    <td className="num">{t.streams.toLocaleString("en-GB")}</td>
                    <td className="num">{fmt(t.amount)}</td>
                  </tr>
                ))}
                {!single && m.tracks.length > 1 ? (
                  <tr className="money-table__total">
                    <td>Total</td>
                    <td />
                    <td className="num">
                      <strong>{fmt(m.amount)}</strong>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            ))}
          </table>
          {data.months.length > 6 ? (
            <button className="button button--ghost button--small" onClick={() => setAll(!all)}>
              {all ? "Show the last 6 months" : `Show all ${data.months.length} months`}
            </button>
          ) : null}
        </>
      )}
      {data.clawbacks.length ? (
        <>
          <h3>Clawbacks</h3>
          <ul className="plain-list">
            {data.clawbacks.map((c) => (
              <li key={`${c.trackId}-${c.date}`}>
                <span>
                  {new Date(c.date).toLocaleDateString("en-GB")} · {c.note}
                </span>
                <strong className="text-danger">{fmt(c.amount)}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="muted small">
        Streams paid is what the monthly payout counted for the whole track. Your money is your share after band splits.
        A month can still change until it's finalised. Tracks labelled {AI_LABELS.ai_generated.name} earn little or
        nothing, which is why they can show streams but no money.
      </p>
    </section>
  );
}
