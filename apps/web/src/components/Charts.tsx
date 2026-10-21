/**
 * Small, accessible charts drawn as inline SVG: no chart library needed.
 *
 * Each chart shows one series in one colour, so nothing depends on telling colours apart; the title says what's
 * plotted. Values are on hover, on keyboard focus (arrow keys move along the chart) and in a table underneath.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

export interface ChartPoint {
  /** What the tooltip and table call this point, e.g. "Tuesday 14 October". */
  label: string;
  /** A short axis label, e.g. "14 Oct". */
  short: string;
  value: number;
}

const HEIGHT = 220;
const PAD = { top: 16, right: 12, bottom: 28, left: 44 };

/** 0 / 1K / 2.5K / 1.2M. */
export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${+(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/** Round axis ticks from 0 to just above `max`. */
function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(6));
}

/** The element's width, kept up to date. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry!.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Values over time: columns for counts per day or week, or a line for running totals (like followers).
 * `format` turns a value into text (for money, say).
 */
export function TimeChart({
  points,
  title,
  kind = "columns",
  format = (n) => n.toLocaleString("en-GB"),
  axisFormat = compact,
}: {
  points: ChartPoint[];
  /** What's plotted, e.g. "Streams per day". Used for screen readers and the table. */
  title: string;
  kind?: "columns" | "line";
  format?: (n: number) => string;
  axisFormat?: (n: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();
  if (points.length === 0) return null;

  const max = Math.max(...points.map((p) => p.value));
  const yTicks = ticks(max);
  const top = yTicks.at(-1)!;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / points.length;
  const x = (i: number) => PAD.left + band * i + band / 2;
  const y = (v: number) => PAD.top + plotH - (top ? (v / top) * plotH : 0);
  const barW = Math.max(2, Math.min(24, band - 2));
  // Label only a few points along the bottom so they never collide.
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 64))));
  const total = points.reduce((a, p) => a + p.value, 0);
  const summary =
    kind === "line"
      ? `${title}: from ${format(points[0]!.value)} to ${format(points.at(-1)!.value)}.`
      : `${title}: ${format(total)} in total, highest ${format(max)}.`;

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left - PAD.left) / band);
    setActive(i >= 0 && i < points.length ? i : null);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const last = points.length - 1;
    const now = active ?? last;
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? last
          : Math.max(0, Math.min(last, now + (e.key === "ArrowLeft" ? -1 : 1)));
    setActive(next);
  };

  const linePath = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const areaPath = `${linePath}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const tip = active !== null ? points[active] : null;

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`${summary} Use the left and right arrow keys to read each value, or see the table below.`}
        aria-describedby={tableId}
        tabIndex={0}
        onPointerMove={onPointer}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line className="chart__grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="chart__tick" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {axisFormat(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          // Every few points, and always the last, leaving out any that would crowd the last one.
          (i % every === 0 && points.length - 1 - i >= every) || i === points.length - 1 ? (
            <text
              key={`x${i}`}
              className="chart__tick"
              x={x(i)}
              y={HEIGHT - 8}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            >
              {p.short}
            </text>
          ) : null,
        )}
        {kind === "columns" ? (
          points.map((p, i) => {
            const h = y(0) - y(p.value);
            if (h <= 0) return null;
            const r = Math.min(4, h, barW / 2);
            const left = x(i) - barW / 2;
            // Rounded at the top, square at the baseline.
            const d = `M${left},${y(0)}V${y(p.value) + r}Q${left},${y(p.value)} ${left + r},${y(p.value)}H${left + barW - r}Q${left + barW},${y(p.value)} ${left + barW},${y(p.value) + r}V${y(0)}Z`;
            return <path key={i} d={d} className={`chart__bar${active === i ? " is-active" : ""}`} />;
          })
        ) : (
          <>
            <path d={areaPath} className="chart__area" />
            <path d={linePath} className="chart__line" />
          </>
        )}
        {active !== null ? (
          <>
            <line className="chart__crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={y(0)} />
            {kind === "line" ? (
              <circle className="chart__dot" cx={x(active)} cy={y(points[active]!.value)} r={5} />
            ) : null}
          </>
        ) : null}
      </svg>
      {tip ? (
        // Beside the crosshair, at the top, so it never hides the mark it describes.
        <div
          className={`chart__tooltip${x(active!) > width / 2 ? " chart__tooltip--left" : ""}`}
          style={{ left: x(active!), top: PAD.top }}
          aria-live="polite"
        >
          <strong>{format(tip.value)}</strong>
          <span>{tip.label}</span>
        </div>
      ) : null}
      <details className="chart__table">
        <summary>Show as a table</summary>
        <table className="table" id={tableId}>
          <caption className="sr-only">{title}</caption>
          <tbody>
            {points.map((p) => (
              <tr key={p.label}>
                <td>{p.label}</td>
                <td className="num">{format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Horizontal bars for a breakdown (where streams came from, say), biggest first, with the value at the tip. */
export function BarList({
  items,
  format = (n) => n.toLocaleString("en-GB"),
}: {
  items: { key: string; label: string; value: number; note?: string }[];
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  return (
    <ul className="bar-list">
      {items.map((item) => (
        <li key={item.key}>
          <span className="bar-list__label">{item.label}</span>
          <span className="bar-list__bar" aria-hidden>
            <span style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
          <span className="bar-list__value">
            {format(item.value)}
            <span className="muted"> · {total ? Math.round((item.value / total) * 100) : 0}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
