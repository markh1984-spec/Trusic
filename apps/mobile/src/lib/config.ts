/**
 * Where the app finds the Trusic API and website.
 *
 * Set these in apps/mobile/.env (copy .env.example). Expo copies EXPO_PUBLIC_*
 * variables into the app when it bundles it, so restart `pnpm start` after a change.
 *
 * - On a physical phone, `localhost` is the phone itself: use your computer's LAN IP,
 *   e.g. http://192.168.1.20:3001/api, and start the API with HOST=0.0.0.0.
 * - The Android emulator reaches your computer at 10.0.2.2.
 */
const DEFAULT_API_URL = "http://localhost:3001/api";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");

/**
 * The Trusic website, where listeners subscribe (the app has no in-app purchases).
 * In production the API serves the website from the same address, so that's the default.
 */
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || new URL(API_URL).origin).replace(/\/+$/, "");

/** The website page with the subscribe button. */
export const SUBSCRIBE_URL = `${SITE_URL}/money`;

/** Used if the API marks a stream as a preview without saying how long it is. */
export const DEFAULT_PREVIEW_MS = 30_000;
