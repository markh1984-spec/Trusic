import type { AiLabel } from "@trusic/core";

/** The web app's colours (apps/web/src/styles.css), so both apps look like one product. */
export const colors = {
  bg: "#0c0d10",
  raised: "#121419",
  card: "#171a20",
  cardPressed: "#1d2129",
  border: "#262a33",
  text: "#eef0f4",
  muted: "#98a0ad",
  primary: "#3fd99a",
  primaryInk: "#04150e",
  human: "#3fd99a",
  assisted: "#f4bf4f",
  generated: "#b48cff",
  danger: "#ff6b6b",
  tabBar: "#000000",
} as const;

/** Each AI label's colour: green for human-made, amber for partly AI, violet for AI. */
export const labelColors: Record<AiLabel, string> = {
  human: colors.human,
  ai_assisted: colors.assisted,
  ai_generated: colors.generated,
};

/** Placeholder artwork backgrounds, tinted by label like the web app's. */
export const artworkTints: Record<AiLabel | "none", string> = {
  human: "#1b4d3b",
  ai_assisted: "#5a4416",
  ai_generated: "#3e2d66",
  none: "#232936",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 12, pill: 999 } as const;
