/**
 * Rules for listening without signal (downloads in the phone and desktop apps).
 */

/** Downloads stop playing unless the app has checked them online within this many days, as on Spotify. */
export const OFFLINE_RECHECK_DAYS = 30;

/** Plays that reach us more than this many days after they happened aren't counted. */
export const MAX_PLAY_AGE_DAYS = 30;

export const DAY_MS = 24 * 60 * 60 * 1000;
