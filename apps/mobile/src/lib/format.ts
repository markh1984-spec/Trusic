import { formatMoney } from "@trusic/core";

export const money = (minor: number, currency = "GBP") => formatMoney(minor, currency);

/** 3:07 */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "2026-09" → "September 2026" */
export function periodName(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${months[m - 1] ?? period} ${y}`;
}

export const plural = (n: number, word: string) => `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;

export const releaseYear = (r: { releaseDate: string | null }) => r.releaseDate?.slice(0, 4) ?? null;

export const RELEASE_TYPE_NAMES = { album: "Album", ep: "EP", single: "Single" } as const;
